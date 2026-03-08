import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, ComposedChart, Area,
} from "recharts";
import {
  TrendingUp, IndianRupee, Download, Table2,
  BarChart2, PieChart as PieIcon, LayoutDashboard,
  ChevronDown, RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

interface DbTable  { id:string; name:string; }
interface DbColumn { id:string; table_id:string; name:string; type:string; }
interface DbRow    { id:string; table_id:string; row_data:Record<string,any>; created_at:string; }

const COLORS = ["#3b82f6","#22c55e","#f59e0b","#ef4444","#a855f7","#06b6d4","#f97316","#ec4899","#84cc16","#14b8a6"];
const toNum  = (v:any) => { if(v==null||v==="") return 0; const n=Number(String(v).replace(/,/g,"")); return isFinite(n)?n:0; };
const fmt    = (n:number) => `₹${n.toLocaleString("en-IN",{maximumFractionDigits:0})}`;
const fmtFull= (n:number) => `₹${n.toLocaleString("en-IN",{minimumFractionDigits:2,maximumFractionDigits:2})}`;

function toDMY(iso:string){ if(!iso)return""; const d=new Date(iso+"T00:00:00"); if(isNaN(d.getTime()))return iso; return`${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}/${d.getFullYear()}`; }

type ChartMode = "bar"|"line"|"pie"|"composed";

// ── Custom tooltip ────────────────────────────────────────────────────────────
const CustomTooltip=({active,payload,label}:any)=>{
  if(!active||!payload?.length) return null;
  return(
    <div className="bg-white border border-gray-200 rounded-xl shadow-xl p-3 text-xs min-w-[140px]">
      <p className="font-semibold text-gray-700 mb-2 border-b pb-1">{label}</p>
      {payload.map((p:any,i:number)=>(
        <div key={i} className="flex items-center justify-between gap-4 py-0.5">
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full" style={{background:p.color}}/>
            <span className="text-gray-500">{p.name}</span>
          </span>
          <span className="font-bold text-gray-800">{fmt(p.value)}</span>
        </div>
      ))}
    </div>
  );
};

export default function AnalyticsPage(){
  const {profile,hasAccess}=useAuth();
  const uid=profile?.id;

  const [tables,setTables]=useState<DbTable[]>([]);
  const [columns,setColumns]=useState<DbColumn[]>([]);
  const [rows,setRows]=useState<DbRow[]>([]);
  const [loading,setLoading]=useState(true);

  // per-table config: which column is X-axis
  const [xAxisMap,setXAxisMap]=useState<Record<string,string>>({});
  const [chartMode,setChartMode]=useState<ChartMode>("bar");
  const [activeTable,setActiveTable]=useState<string|null>(null);

  useEffect(()=>{
    if(!uid)return;
    (async()=>{
      setLoading(true);
      const {data:tbls}=await supabase.from("user_tables").select("id,name").eq("user_id",uid);
      const tableList=(tbls??[]) as DbTable[];
      setTables(tableList);
      if(!tableList.length){setLoading(false);return;}
      const ids=tableList.map(t=>t.id);
      const {data:cols}=await supabase.from("user_columns").select("*").in("table_id",ids);
      const allCols=(cols??[]) as DbColumn[];
      setColumns(allCols);
      const amountTableIds=[...new Set(allCols.filter(c=>c.type==="amount").map(c=>c.table_id))];
      if(!amountTableIds.length){setLoading(false);return;}
      const {data:rowData}=await supabase.from("user_rows").select("*").in("table_id",amountTableIds).order("created_at");
      setRows(((rowData??[]) as DbRow[]).map(r=>({...r,row_data:r.row_data??{}})));

      // auto-set X axis: prefer date col, else first text col, else first col
      const map:Record<string,string>={};
      amountTableIds.forEach(tid=>{
        const tCols=allCols.filter(c=>c.table_id===tid);
        const dateCol=tCols.find(c=>c.type==="date");
        const textCol=tCols.find(c=>c.type==="text");
        map[tid]=(dateCol||textCol||tCols[0])?.name??"";
      });
      setXAxisMap(map);
      setActiveTable(amountTableIds[0]);
      setLoading(false);
    })();
  },[uid]);

  // ── pivot data per table ───────────────────────────────────────────────────
  const pivotData=useMemo(()=>{
    return tables.map(table=>{
      const tCols=columns.filter(c=>c.table_id===table.id);
      const amtCols=tCols.filter(c=>c.type==="amount");
      if(!amtCols.length) return null;
      const tRows=rows.filter(r=>r.table_id===table.id);
      if(!tRows.length) return null;

      const xCol=xAxisMap[table.id]??"";

      // build chart rows
      const chartRows=tRows.map((r,i)=>{
        const xVal=xCol?(r.row_data[xCol]!=null&&r.row_data[xCol]!==""
          ?(tCols.find(c=>c.name===xCol)?.type==="date"?toDMY(String(r.row_data[xCol])):String(r.row_data[xCol]))
          :`Row ${i+1}`):`Row ${i+1}`;
        const entry:Record<string,any>={name:xVal};
        amtCols.forEach(c=>{entry[c.name]=toNum(r.row_data[c.name]);});
        return entry;
      });

      // stats per amount col
      const stats=amtCols.map(col=>{
        const vals=tRows.map(r=>toNum(r.row_data[col.name]));
        const total=vals.reduce((a,b)=>a+b,0);
        const nonZero=vals.filter(v=>v>0);
        return{
          col,
          total,
          avg: nonZero.length?total/nonZero.length:0,
          max: Math.max(...vals),
          min: nonZero.length?Math.min(...nonZero):0,
          count: nonZero.length,
        };
      });

      return{table,tCols,amtCols,chartRows,stats,xCol};
    }).filter(Boolean) as {
      table:DbTable;
      tCols:DbColumn[];
      amtCols:DbColumn[];
      chartRows:Record<string,any>[];
      stats:{col:DbColumn;total:number;avg:number;max:number;min:number;count:number}[];
      xCol:string;
    }[];
  },[tables,columns,rows,xAxisMap]);

  // ── PDF download ──────────────────────────────────────────────────────────
  const dlPDF=()=>{
    if(!hasAccess) return toast.error("Upgrade to download");
    const pd=pivotData.find(p=>p.table.id===activeTable)||pivotData[0];
    if(!pd) return toast.error("No data");

    const doc=new jsPDF({orientation:"l",unit:"pt",format:"a4"});
    const pg=doc.internal.pageSize;

    // Header
    doc.setFillColor(30,30,30);
    doc.rect(0,0,pg.width,50,"F");
    doc.setTextColor(255,255,255);
    doc.setFont("helvetica","bold");
    doc.setFontSize(18);
    doc.text(`${pd.table.name} — Analytics Report`,40,32);
    doc.setFontSize(9);
    doc.setFont("helvetica","normal");
    doc.text(`Generated: ${new Date().toLocaleString("en-IN")}`,40,45);

    let y=70;

    // Summary cards
    doc.setTextColor(30,30,30);
    doc.setFont("helvetica","bold");
    doc.setFontSize(11);
    doc.text("Summary",40,y);
    y+=14;

    pd.stats.forEach((s,si)=>{
      const cards=[
        {label:"Total",val:fmtFull(s.total)},
        {label:"Average",val:fmtFull(s.avg)},
        {label:"Highest",val:fmtFull(s.max)},
        {label:"Lowest",val:fmtFull(s.min)},
        {label:"Entries",val:String(s.count)},
      ];
      const cardW=(pg.width-80)/cards.length;
      doc.setFont("helvetica","bold");
      doc.setFontSize(9);
      doc.setTextColor(80,80,80);
      doc.text(s.col.name,40,y);
      y+=4;
      cards.forEach((c,ci)=>{
        const x=40+ci*cardW;
        doc.setFillColor(248,249,250);
        doc.roundedRect(x,y,cardW-4,32,3,3,"F");
        doc.setFont("helvetica","normal");
        doc.setFontSize(7);
        doc.setTextColor(120,120,120);
        doc.text(c.label,x+6,y+11);
        doc.setFont("helvetica","bold");
        doc.setFontSize(9);
        doc.setTextColor(30,30,30);
        doc.text(c.val,x+6,y+24);
      });
      y+=40;
    });

    y+=8;

    // Data table
    doc.setFont("helvetica","bold");
    doc.setFontSize(11);
    doc.setTextColor(30,30,30);
    doc.text("Data",40,y);
    y+=8;

    const head=[[pd.xCol||"Row",...pd.amtCols.map(c=>c.name)]];
    const body=pd.chartRows.map(r=>[r.name,...pd.amtCols.map(c=>fmtFull(r[c.name]??0))]);

    // Totals row
    body.push(["TOTAL",...pd.stats.map(s=>fmtFull(s.total))]);

    autoTable(doc,{
      startY:y,
      head,body,
      styles:{font:"helvetica",fontSize:8,cellPadding:5},
      headStyles:{fillColor:[30,30,30],textColor:255,fontStyle:"bold"},
      footStyles:{fillColor:[240,240,240],fontStyle:"bold"},
      columnStyles:{0:{fontStyle:"bold"}},
      alternateRowStyles:{fillColor:[248,249,250]},
      didParseCell:(data:any)=>{
        if(data.row.index===body.length-1){
          data.cell.styles.fillColor=[220,230,255];
          data.cell.styles.fontStyle="bold";
        }
      },
      margin:{left:40,right:40},
    });

    doc.save(`${pd.table.name}-analytics.pdf`);
    toast.success("PDF downloaded");
  };

  // ── render chart ──────────────────────────────────────────────────────────
  const renderChart=(pd:typeof pivotData[0],mode:ChartMode)=>{
    if(!pd||!pd.chartRows.length) return null;
    const {chartRows,amtCols}=pd;

    const commonProps={
      data:chartRows,
      margin:{top:8,right:24,bottom:40,left:16},
    };
    const xAxis=<XAxis dataKey="name" tick={{fontSize:10,fill:"#6b7280"}} tickLine={false} angle={-35} textAnchor="end" interval={0}/>;
    const yAxis=<YAxis tick={{fontSize:10,fill:"#6b7280"}} tickLine={false} axisLine={false} tickFormatter={(v)=>`₹${Number(v).toLocaleString("en-IN")}`} width={72}/>;
    const grid=<CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false}/>;
    const legend=<Legend wrapperStyle={{fontSize:11,paddingTop:8}}/>;

    if(mode==="pie"){
      // pie: one chart per amount col, showing distribution across rows
      return(
        <div className={`grid gap-6 ${amtCols.length>1?"grid-cols-2":"grid-cols-1"}`}>
          {amtCols.map((col,ci)=>{
            const pieData=chartRows.map(r=>({name:r.name,value:r[col.name]??0})).filter(d=>d.value>0);
            return(
              <div key={col.id}>
                <p className="text-xs font-semibold text-gray-500 mb-2 text-center">{col.name}</p>
                <ResponsiveContainer width="100%" height={280}>
                  <PieChart>
                    <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="45%" outerRadius={100} innerRadius={40} paddingAngle={2}>
                      {pieData.map((_,i)=><Cell key={i} fill={COLORS[i%COLORS.length]}/>)}
                    </Pie>
                    <Tooltip content={<CustomTooltip/>}/>
                    <Legend wrapperStyle={{fontSize:10}}/>
                  </PieChart>
                </ResponsiveContainer>
              </div>
            );
          })}
        </div>
      );
    }

    if(mode==="composed"){
      return(
        <ResponsiveContainer width="100%" height={300}>
          <ComposedChart {...commonProps}>
            {grid}{xAxis}{yAxis}
            <Tooltip content={<CustomTooltip/>}/>{legend}
            {amtCols.map((col,i)=>(
              i===0
                ?<Bar key={col.id} dataKey={col.name} fill={COLORS[i%COLORS.length]} radius={[3,3,0,0]} maxBarSize={48}/>
                :<Line key={col.id} type="monotone" dataKey={col.name} stroke={COLORS[i%COLORS.length]} strokeWidth={2} dot={{r:3}}/>
            ))}
          </ComposedChart>
        </ResponsiveContainer>
      );
    }

    if(mode==="line"){
      return(
        <ResponsiveContainer width="100%" height={300}>
          <LineChart {...commonProps}>
            {grid}{xAxis}{yAxis}
            <Tooltip content={<CustomTooltip/>}/>{legend}
            {amtCols.map((col,i)=>(
              <Line key={col.id} type="monotone" dataKey={col.name} stroke={COLORS[i%COLORS.length]} strokeWidth={2.5} dot={{r:4,fill:COLORS[i%COLORS.length]}} activeDot={{r:6}}/>
            ))}
          </LineChart>
        </ResponsiveContainer>
      );
    }

    // bar (default)
    return(
      <ResponsiveContainer width="100%" height={300}>
        <BarChart {...commonProps}>
          {grid}{xAxis}{yAxis}
          <Tooltip content={<CustomTooltip/>}/>{legend}
          {amtCols.map((col,i)=>(
            <Bar key={col.id} dataKey={col.name} fill={COLORS[i%COLORS.length]} radius={[4,4,0,0]} maxBarSize={48}/>
          ))}
        </BarChart>
      </ResponsiveContainer>
    );
  };

  // ─────────────────────────────────────────────────────────────────────────
  if(loading) return(
    <div className="flex items-center justify-center h-64">
      <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full"/>
    </div>
  );

  if(!pivotData.length) return(
    <div className="flex flex-col items-center justify-center h-64 text-center gap-3">
      <IndianRupee className="w-16 h-16 text-muted-foreground/20"/>
      <h3 className="text-lg font-semibold">No Amount columns found</h3>
      <p className="text-muted-foreground text-sm max-w-xs">Tables page mein kisi column ka type <strong>Amount (₹)</strong> set karo — yahan analytics aa jaayega.</p>
    </div>
  );

  const activePD=pivotData.find(p=>p.table.id===activeTable)||pivotData[0];

  return(
    <div className="space-y-0 pb-8 -mt-2">

      {/* ── TOP BAR ─────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <TrendingUp className="w-6 h-6 text-primary"/>Analytics
          </h1>
          <p className="text-muted-foreground text-sm mt-0.5">Pivot view — Amount columns</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Chart type */}
          <div className="flex items-center gap-1 bg-muted rounded-lg p-1">
            {([["bar","Bar",BarChart2],["line","Line",TrendingUp],["pie","Pie",PieIcon],["composed","Mixed",LayoutDashboard]] as const).map(([k,label,Icon])=>(
              <button key={k} onClick={()=>setChartMode(k as ChartMode)}
                className={`flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium transition-all ${chartMode===k?"bg-background shadow text-foreground":"text-muted-foreground hover:text-foreground"}`}>
                <Icon className="w-3.5 h-3.5"/>{label}
              </button>
            ))}
          </div>
          {/* PDF */}
          <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={dlPDF}>
            <Download className="w-3.5 h-3.5"/>PDF
          </Button>
        </div>
      </div>

      {/* ── SHEET TABS ───────────────────────────────────────────────────── */}
      {pivotData.length>1&&(
        <div className="flex gap-1 mb-5 border-b overflow-x-auto pb-0">
          {pivotData.map(pd=>(
            <button key={pd.table.id}
              onClick={()=>setActiveTable(pd.table.id)}
              className={`flex items-center gap-1.5 px-4 py-2 text-sm whitespace-nowrap border-b-2 transition-all -mb-px ${activeTable===pd.table.id?"border-primary text-primary font-medium":"border-transparent text-muted-foreground hover:text-foreground"}`}>
              <Table2 className="w-3.5 h-3.5"/>{pd.table.name}
            </button>
          ))}
        </div>
      )}

      {activePD&&(
        <div className="space-y-5">

          {/* ── X-AXIS PICKER ──────────────────────────────────────────── */}
          <div className="flex items-center gap-3 bg-muted/40 rounded-xl px-4 py-3">
            <span className="text-xs text-muted-foreground font-medium whitespace-nowrap">X-Axis (Category):</span>
            <Select
              value={xAxisMap[activePD.table.id]??""}
              onValueChange={v=>setXAxisMap(p=>({...p,[activePD.table.id]:v}))}>
              <SelectTrigger className="h-7 w-44 text-xs bg-background">
                <SelectValue placeholder="Choose column..."/>
              </SelectTrigger>
              <SelectContent>
                {activePD.tCols.filter(c=>c.type!=="amount").map(c=>(
                  <SelectItem key={c.id} value={c.name} className="text-xs">{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-xs text-muted-foreground">Y-Axis: <strong className="text-foreground">{activePD.amtCols.map(c=>c.name).join(", ")}</strong></span>
          </div>

          {/* ── STAT CARDS ─────────────────────────────────────────────── */}
          {activePD.stats.map((s,si)=>(
            <div key={s.col.id}>
              {activePD.stats.length>1&&(
                <p className="text-xs font-semibold text-muted-foreground mb-2 flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full" style={{background:COLORS[si%COLORS.length]}}/>
                  {s.col.name}
                </p>
              )}
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                {[
                  {label:"Total",value:fmt(s.total),sub:fmtFull(s.total),icon:"Σ",color:"text-blue-600"},
                  {label:"Average",value:fmt(s.avg),sub:fmtFull(s.avg),icon:"∅",color:"text-green-600"},
                  {label:"Highest",value:fmt(s.max),sub:fmtFull(s.max),icon:"↑",color:"text-orange-500"},
                  {label:"Lowest",value:fmt(s.min),sub:fmtFull(s.min),icon:"↓",color:"text-red-500"},
                  {label:"Entries",value:String(s.count),sub:"non-zero rows",icon:"#",color:"text-purple-600"},
                ].map(card=>(
                  <div key={card.label} className="bg-card border rounded-xl p-4 hover:shadow-md transition-shadow">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs text-muted-foreground">{card.label}</span>
                      <span className={`text-base font-bold ${card.color} opacity-30`}>{card.icon}</span>
                    </div>
                    <p className={`text-xl font-bold ${card.color}`}>{card.value}</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">{card.sub}</p>
                  </div>
                ))}
              </div>
            </div>
          ))}

          {/* ── PIVOT CHART ────────────────────────────────────────────── */}
          <div className="bg-card border rounded-xl p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="font-semibold text-sm">{activePD.amtCols.map(c=>c.name).join(" vs ")} — by {activePD.xCol||"Row"}</h3>
                <p className="text-xs text-muted-foreground mt-0.5">{activePD.chartRows.length} data points</p>
              </div>
            </div>
            {renderChart(activePD,chartMode)}
          </div>

          {/* ── DATA TABLE ─────────────────────────────────────────────── */}
          <div className="bg-card border rounded-xl overflow-hidden">
            <div className="px-5 py-3 border-b flex items-center justify-between">
              <h3 className="font-semibold text-sm">Data Table</h3>
              <span className="text-xs text-muted-foreground">{activePD.chartRows.length} rows</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-muted/50">
                    <th className="text-left px-4 py-2.5 font-semibold text-muted-foreground">{activePD.xCol||"Row"}</th>
                    {activePD.amtCols.map(c=>(
                      <th key={c.id} className="text-right px-4 py-2.5 font-semibold text-muted-foreground">{c.name}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {activePD.chartRows.map((r,i)=>(
                    <tr key={i} className={i%2===0?"bg-white":"bg-muted/20"}>
                      <td className="px-4 py-2 font-medium">{r.name}</td>
                      {activePD.amtCols.map(c=>(
                        <td key={c.id} className="px-4 py-2 text-right text-primary font-medium">{fmtFull(r[c.name]??0)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-blue-50 font-bold border-t-2 border-blue-200">
                    <td className="px-4 py-2.5 text-blue-700">Total</td>
                    {activePD.stats.map(s=>(
                      <td key={s.col.id} className="px-4 py-2.5 text-right text-blue-700">{fmtFull(s.total)}</td>
                    ))}
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

        </div>
      )}
    </div>
  );
}
