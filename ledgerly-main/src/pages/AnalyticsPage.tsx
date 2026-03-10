import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, ComposedChart,
} from "recharts";
import {
  TrendingUp, IndianRupee, Download, Table2,
  BarChart2, PieChart as PieIcon, LayoutDashboard,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { formatCurrency, formatCurrencyPDF, getCurrencySymbol } from "@/lib/currency";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

interface DbTable  { id:string; name:string; }
interface DbColumn { id:string; table_id:string; name:string; type:string; }
interface DbRow    { id:string; table_id:string; row_data:Record<string,any>; created_at:string; }

const COLORS=["#3b82f6","#22c55e","#f59e0b","#ef4444","#a855f7","#06b6d4","#f97316","#ec4899","#84cc16","#14b8a6"];
const toNum=(v:any)=>{if(v==null||v==="")return 0;const n=Number(String(v).replace(/,/g,""));return isFinite(n)?n:0;};

function toDMY(iso:string){if(!iso)return"";const d=new Date(iso+"T00:00:00");if(isNaN(d.getTime()))return iso;return`${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}/${d.getFullYear()}`;}

type ChartMode="bar"|"line"|"pie"|"composed";

const CustomTooltip=({active,payload,label,cur}:any)=>{
  if(!active||!payload?.length)return null;
  return(
    <div className="bg-white border border-gray-200 rounded-xl shadow-xl p-3 text-xs min-w-[140px]">
      <p className="font-semibold text-gray-700 mb-2 border-b pb-1">{label}</p>
      {payload.map((p:any,i:number)=>(
        <div key={i} className="flex items-center justify-between gap-4 py-0.5">
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full" style={{background:p.color}}/>
            <span className="text-gray-500">{p.name}</span>
          </span>
          <span className="font-bold text-gray-800">{formatCurrency(p.value,cur)}</span>
        </div>
      ))}
    </div>
  );
};

// ── draw bar chart on canvas (for PDF) ──────────────────────────────────────
function drawBarChart(canvas:HTMLCanvasElement,chartRows:Record<string,any>[],amtCol:string,cur:string){
  const ctx=canvas.getContext("2d")!;
  const W=canvas.width,H=canvas.height;
  const pad={top:20,right:20,bottom:50,left:70};
  ctx.clearRect(0,0,W,H);
  ctx.fillStyle="#fff";ctx.fillRect(0,0,W,H);

  const vals=chartRows.map(r=>toNum(r[amtCol]));
  const maxV=Math.max(...vals,1);
  const barW=Math.min(40,(W-pad.left-pad.right)/chartRows.length-6);
  const chartH=H-pad.top-pad.bottom;
  const chartW=W-pad.left-pad.right;

  // grid lines
  ctx.strokeStyle="#f0f0f0";ctx.lineWidth=1;
  [0,0.25,0.5,0.75,1].forEach(f=>{
    const y=pad.top+chartH*(1-f);
    ctx.beginPath();ctx.moveTo(pad.left,y);ctx.lineTo(W-pad.right,y);ctx.stroke();
    ctx.fillStyle="#9ca3af";ctx.font="9px Arial";ctx.textAlign="right";
    ctx.fillText(formatCurrencyPDF(maxV*f,cur).replace(/\.00$/,""),pad.left-4,y+3);
  });

  // bars
  chartRows.forEach((r,i)=>{
    const x=pad.left+i*(chartW/chartRows.length)+(chartW/chartRows.length-barW)/2;
    const barH=(toNum(r[amtCol])/maxV)*chartH;
    const y=pad.top+chartH-barH;
    const hue=COLORS[0];
    ctx.fillStyle=hue;
    ctx.beginPath();
    if(typeof (ctx as any).roundRect==="function"){(ctx as any).roundRect(x,y,barW,barH,3);}else{ctx.rect(x,y,barW,barH);}
    ctx.fill();
    // x label
    ctx.fillStyle="#6b7280";ctx.font="8px Arial";ctx.textAlign="center";
    const lbl=String(r.name).slice(0,8);
    ctx.fillText(lbl,x+barW/2,H-pad.bottom+14);
  });
}

function drawPieChart(canvas:HTMLCanvasElement,chartRows:Record<string,any>[],amtCol:string){
  const ctx=canvas.getContext("2d")!;
  const W=canvas.width,H=canvas.height;
  ctx.clearRect(0,0,W,H);ctx.fillStyle="#fff";ctx.fillRect(0,0,W,H);

  const data=chartRows.map(r=>({name:String(r.name),value:toNum(r[amtCol])})).filter(d=>d.value>0);
  const total=data.reduce((s,d)=>s+d.value,0);
  const cx=W*0.38,cy=H/2,r=Math.min(W,H)*0.35;

  let startAngle=-Math.PI/2;
  data.forEach((d,i)=>{
    const slice=(d.value/total)*2*Math.PI;
    ctx.beginPath();ctx.moveTo(cx,cy);
    ctx.arc(cx,cy,r,startAngle,startAngle+slice);
    ctx.closePath();ctx.fillStyle=COLORS[i%COLORS.length];ctx.fill();
    ctx.strokeStyle="#fff";ctx.lineWidth=2;ctx.stroke();
    startAngle+=slice;
  });

  // legend
  const legendX=W*0.72,legendY=H*0.15;
  data.slice(0,8).forEach((d,i)=>{
    const y=legendY+i*18;
    ctx.fillStyle=COLORS[i%COLORS.length];
    ctx.fillRect(legendX,y,12,12);
    ctx.fillStyle="#374151";ctx.font="9px Arial";ctx.textAlign="left";
    const pct=((d.value/total)*100).toFixed(1);
    ctx.fillText(`${String(d.name).slice(0,12)} (${pct}%)`,legendX+16,y+10);
  });
}

export default function AnalyticsPage(){
  const {profile,hasAccess,userCurrency}=useAuth();
  const uid=profile?.id;
  const cur=userCurrency||"INR";

  const [tables,setTables]=useState<DbTable[]>([]);
  const [columns,setColumns]=useState<DbColumn[]>([]);
  const [rows,setRows]=useState<DbRow[]>([]);
  const [loading,setLoading]=useState(true);
  const [xAxisMap,setXAxisMap]=useState<Record<string,string>>({});
  const [chartMode,setChartMode]=useState<ChartMode>("bar");
  const [activeTable,setActiveTable]=useState<string|null>(null);

  const barCanvasRef=useRef<HTMLCanvasElement>(null);
  const pieCanvasRef=useRef<HTMLCanvasElement>(null);

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
      const amtTids=[...new Set(allCols.filter(c=>c.type==="amount").map(c=>c.table_id))];
      if(!amtTids.length){setLoading(false);return;}
      const {data:rowData}=await supabase.from("user_rows").select("*").in("table_id",amtTids).order("created_at");
      setRows(((rowData??[]) as DbRow[]).map(r=>({...r,row_data:r.row_data??{}})));
      const map:Record<string,string>={};
      amtTids.forEach(tid=>{
        const tCols=allCols.filter(c=>c.table_id===tid);
        map[tid]=(tCols.find(c=>c.type==="date")||tCols.find(c=>c.type==="text")||tCols[0])?.name??"";
      });
      setXAxisMap(map);
      setActiveTable(amtTids[0]);
      setLoading(false);
    })();
  },[uid]);

  const pivotData=useMemo(()=>{
    return tables.map(table=>{
      const tCols=columns.filter(c=>c.table_id===table.id);
      const amtCols=tCols.filter(c=>c.type==="amount");
      if(!amtCols.length)return null;
      const tRows=rows.filter(r=>r.table_id===table.id);
      if(!tRows.length)return null;
      const xCol=xAxisMap[table.id]??"";
      const chartRows=tRows.map((r,i)=>{
        const raw=xCol?r.row_data[xCol]:null;
        const xVal=raw!=null&&raw!==""
          ?(tCols.find(c=>c.name===xCol)?.type==="date"?toDMY(String(raw)):String(raw))
          :`Row ${i+1}`;
        const entry:Record<string,any>={name:xVal};
        amtCols.forEach(c=>{entry[c.name]=toNum(r.row_data[c.name]);});
        return entry;
      });
      const stats=amtCols.map(col=>{
        const vals=tRows.map(r=>toNum(r.row_data[col.name]));
        const total=vals.reduce((a,b)=>a+b,0);
        const nz=vals.filter(v=>v>0);
        return{col,total,avg:nz.length?total/nz.length:0,max:Math.max(...vals),min:nz.length?Math.min(...nz):0,count:nz.length};
      });
      return{table,tCols,amtCols,chartRows,stats,xCol};
    }).filter(Boolean) as {table:DbTable;tCols:DbColumn[];amtCols:DbColumn[];chartRows:Record<string,any>[];stats:{col:DbColumn;total:number;avg:number;max:number;min:number;count:number}[];xCol:string}[];
  },[tables,columns,rows,xAxisMap]);

  // ── PDF with charts ────────────────────────────────────────────────────────
  const dlPDF=async()=>{
    if(!hasAccess)return toast.error("Upgrade to download");
    const pd=pivotData.find(p=>p.table.id===activeTable)||pivotData[0];
    if(!pd)return toast.error("No data");

    // draw charts on hidden canvases
    const barC=document.createElement("canvas");barC.width=520;barC.height=200;
    const pieC=document.createElement("canvas");pieC.width=520;pieC.height=200;
    drawBarChart(barC,pd.chartRows,pd.amtCols[0].name,cur);
    drawPieChart(pieC,pd.chartRows,pd.amtCols[0].name);
    const barImg=barC.toDataURL("image/png");
    const pieImg=pieC.toDataURL("image/png");

    const doc=new jsPDF({orientation:"l",unit:"pt",format:"a4"});
    const pw=doc.internal.pageSize.width;

    // header
    doc.setFillColor(30,30,30);doc.rect(0,0,pw,48,"F");
    doc.setTextColor(255,255,255);doc.setFont("helvetica","bold");doc.setFontSize(16);
    doc.text(`${pd.table.name} — Analytics Report`,36,30);
    doc.setFont("helvetica","normal");doc.setFontSize(8);
    doc.text(`Generated: ${new Date().toLocaleString("en-IN")}   |   Currency: ${cur}`,36,42);

    let y=62;

    // summary cards
    doc.setTextColor(30,30,30);doc.setFont("helvetica","bold");doc.setFontSize(10);
    doc.text("Summary",36,y);y+=10;
    pd.stats.forEach(s=>{
      const cards=[
        {l:"Total",v:formatCurrencyPDF(s.total,cur)},
        {l:"Average",v:formatCurrencyPDF(s.avg,cur)},
        {l:"Highest",v:formatCurrencyPDF(s.max,cur)},
        {l:"Lowest",v:formatCurrencyPDF(s.min,cur)},
        {l:"Entries",v:String(s.count)},
      ];
      const cw=(pw-72)/cards.length;
      doc.setFont("helvetica","normal");doc.setFontSize(7);doc.setTextColor(100,100,100);
      doc.text(s.col.name,36,y);y+=3;
      cards.forEach((c,i)=>{
        const x=36+i*cw;
        doc.setFillColor(246,248,250);doc.roundedRect(x,y,cw-4,28,2,2,"F");
        doc.setFont("helvetica","normal");doc.setFontSize(6.5);doc.setTextColor(130,130,130);
        doc.text(c.l,x+5,y+9);
        doc.setFont("helvetica","bold");doc.setFontSize(8);doc.setTextColor(30,30,30);
        doc.text(c.v,x+5,y+21);
      });
      y+=34;
    });

    y+=6;

    // charts side by side
    doc.setFont("helvetica","bold");doc.setFontSize(10);doc.setTextColor(30,30,30);
    doc.text("Bar Chart",36,y);
    doc.text("Distribution (Pie)",pw/2+10,y);
    y+=4;
    const chartH=130;
    doc.addImage(barImg,"PNG",36,y,pw/2-46,chartH);
    doc.addImage(pieImg,"PNG",pw/2+6,y,pw/2-46,chartH);
    y+=chartH+14;

    // data table
    doc.setFont("helvetica","bold");doc.setFontSize(10);
    doc.text("Data",36,y);y+=6;
    const head=[[pd.xCol||"Row",...pd.amtCols.map(c=>c.name)]];
    const body=pd.chartRows.map(r=>[r.name,...pd.amtCols.map(c=>formatCurrencyPDF(r[c.name]??0,cur))]);
    body.push(["TOTAL",...pd.stats.map(s=>formatCurrencyPDF(s.total,cur))]);
    autoTable(doc,{
      startY:y,head,body,
      styles:{font:"helvetica",fontSize:7.5,cellPadding:4},
      headStyles:{fillColor:[30,30,30],textColor:255,fontStyle:"bold"},
      alternateRowStyles:{fillColor:[248,249,250]},
      columnStyles:{0:{fontStyle:"bold"}},
      didParseCell:(d:any)=>{if(d.row.index===body.length-1){d.cell.styles.fillColor=[220,230,255];d.cell.styles.fontStyle="bold";}},
      margin:{left:36,right:36},
    });

    doc.save(`${pd.table.name}-analytics.pdf`);
    toast.success("PDF downloaded");
  };

  const renderChart=(pd:typeof pivotData[0],mode:ChartMode)=>{
    if(!pd||!pd.chartRows.length)return null;
    const {chartRows,amtCols}=pd;
    const common={data:chartRows,margin:{top:8,right:24,bottom:50,left:16}};
    const xAx=<XAxis dataKey="name" tick={{fontSize:10,fill:"#6b7280"}} tickLine={false} angle={-30} textAnchor="end" interval={0}/>;
    const yAx=<YAxis tick={{fontSize:10,fill:"#6b7280"}} tickLine={false} axisLine={false} tickFormatter={v=>formatCurrency(Number(v),cur)} width={80}/>;
    const grid=<CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false}/>;
    const tip=<Tooltip content={<CustomTooltip cur={cur}/>}/>;
    const leg=<Legend wrapperStyle={{fontSize:11,paddingTop:8}}/>;

    if(mode==="pie"){
      return(
        <div className={`grid gap-6 ${amtCols.length>1?"grid-cols-2":"grid-cols-1"}`}>
          {amtCols.map((col,ci)=>{
            const pd2=chartRows.map(r=>({name:r.name,value:r[col.name]??0})).filter(d=>d.value>0);
            return(
              <div key={col.id}>
                <p className="text-xs font-semibold text-gray-500 mb-2 text-center">{col.name}</p>
                <ResponsiveContainer width="100%" height={280}>
                  <PieChart>
                    <Pie data={pd2} dataKey="value" nameKey="name" cx="50%" cy="45%" outerRadius={100} innerRadius={40} paddingAngle={2}>
                      {pd2.map((_,i)=><Cell key={i} fill={COLORS[i%COLORS.length]}/>)}
                    </Pie>
                    <Tooltip content={<CustomTooltip cur={cur}/>}/><Legend wrapperStyle={{fontSize:10}}/>
                  </PieChart>
                </ResponsiveContainer>
              </div>
            );
          })}
        </div>
      );
    }
    if(mode==="line"){
      return(
        <ResponsiveContainer width="100%" height={300}>
          <LineChart {...common}>{grid}{xAx}{yAx}{tip}{leg}
            {amtCols.map((col,i)=><Line key={col.id} type="monotone" dataKey={col.name} stroke={COLORS[i%COLORS.length]} strokeWidth={2.5} dot={{r:4}} activeDot={{r:6}}/>)}
          </LineChart>
        </ResponsiveContainer>
      );
    }
    if(mode==="composed"){
      return(
        <ResponsiveContainer width="100%" height={300}>
          <ComposedChart {...common}>{grid}{xAx}{yAx}{tip}{leg}
            {amtCols.map((col,i)=>i===0
              ?<Bar key={col.id} dataKey={col.name} fill={COLORS[0]} radius={[4,4,0,0]} maxBarSize={48}/>
              :<Line key={col.id} type="monotone" dataKey={col.name} stroke={COLORS[i%COLORS.length]} strokeWidth={2} dot={{r:3}}/>
            )}
          </ComposedChart>
        </ResponsiveContainer>
      );
    }
    return(
      <ResponsiveContainer width="100%" height={300}>
        <BarChart {...common}>{grid}{xAx}{yAx}{tip}{leg}
          {amtCols.map((col,i)=><Bar key={col.id} dataKey={col.name} fill={COLORS[i%COLORS.length]} radius={[4,4,0,0]} maxBarSize={48}/>)}
        </BarChart>
      </ResponsiveContainer>
    );
  };

  if(loading)return<div className="flex items-center justify-center h-64"><div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full"/></div>;

  if(!pivotData.length)return(
    <div className="flex flex-col items-center justify-center h-64 text-center gap-3">
      <IndianRupee className="w-16 h-16 text-muted-foreground/20"/>
      <h3 className="text-lg font-semibold">No Amount columns found</h3>
      <p className="text-muted-foreground text-sm max-w-xs">Set at least one column type to <strong>Amount (₹)</strong> on the Tables page.</p>
    </div>
  );

  const activePD=pivotData.find(p=>p.table.id===activeTable)||pivotData[0];
  const sym=getCurrencySymbol(cur);

  return(
    <div className="space-y-5 pb-8 -mt-2">
      {/* TOP BAR */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><TrendingUp className="w-6 h-6 text-primary"/>Analytics</h1>
          <p className="text-muted-foreground text-sm mt-0.5">Pivot view · Currency: <strong>{sym} {cur}</strong></p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1 bg-muted rounded-lg p-1">
            {([["bar","Bar",BarChart2],["line","Line",TrendingUp],["pie","Pie",PieIcon],["composed","Mixed",LayoutDashboard]] as const).map(([k,label,Icon])=>(
              <button key={k} onClick={()=>setChartMode(k as ChartMode)}
                className={`flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium transition-all ${chartMode===k?"bg-background shadow text-foreground":"text-muted-foreground hover:text-foreground"}`}>
                <Icon className="w-3.5 h-3.5"/>{label}
              </button>
            ))}
          </div>
          <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={dlPDF}>
            <Download className="w-3.5 h-3.5"/>PDF
          </Button>
        </div>
      </div>

      {/* SHEET TABS */}
      {pivotData.length>1&&(
        <div className="flex gap-1 border-b overflow-x-auto pb-0">
          {pivotData.map(pd=>(
            <button key={pd.table.id} onClick={()=>setActiveTable(pd.table.id)}
              className={`flex items-center gap-1.5 px-4 py-2 text-sm whitespace-nowrap border-b-2 transition-all -mb-px ${activeTable===pd.table.id?"border-primary text-primary font-medium":"border-transparent text-muted-foreground hover:text-foreground"}`}>
              <Table2 className="w-3.5 h-3.5"/>{pd.table.name}
            </button>
          ))}
        </div>
      )}

      {activePD&&(<>
        {/* X-AXIS PICKER */}
        <div className="flex items-center gap-3 bg-muted/40 rounded-xl px-4 py-3 flex-wrap">
          <span className="text-xs text-muted-foreground font-medium">X-Axis:</span>
          <Select value={xAxisMap[activePD.table.id]??""} onValueChange={v=>setXAxisMap(p=>({...p,[activePD.table.id]:v}))}>
            <SelectTrigger className="h-7 w-44 text-xs bg-background"><SelectValue placeholder="Choose column..."/></SelectTrigger>
            <SelectContent>
              {activePD.tCols.filter(c=>c.type!=="amount").map(c=><SelectItem key={c.id} value={c.name} className="text-xs">{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <span className="text-xs text-muted-foreground">Y-Axis: <strong className="text-foreground">{activePD.amtCols.map(c=>c.name).join(", ")}</strong></span>
        </div>

        {/* STAT CARDS */}
        {activePD.stats.map((s,si)=>(
          <div key={s.col.id}>
            {activePD.stats.length>1&&<p className="text-xs font-semibold text-muted-foreground mb-2 flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{background:COLORS[si%COLORS.length]}}/>{s.col.name}</p>}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              {[
                {label:"Total",value:formatCurrency(s.total,cur),icon:"Σ",color:"text-blue-600"},
                {label:"Average",value:formatCurrency(s.avg,cur),icon:"∅",color:"text-green-600"},
                {label:"Highest",value:formatCurrency(s.max,cur),icon:"↑",color:"text-orange-500"},
                {label:"Lowest",value:formatCurrency(s.min,cur),icon:"↓",color:"text-red-500"},
                {label:"Entries",value:String(s.count),icon:"#",color:"text-purple-600"},
              ].map(c=>(
                <div key={c.label} className="bg-card border rounded-xl p-4 hover:shadow-md transition-shadow">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs text-muted-foreground">{c.label}</span>
                    <span className={`text-base font-bold opacity-20 ${c.color}`}>{c.icon}</span>
                  </div>
                  <p className={`text-xl font-bold ${c.color}`}>{c.value}</p>
                </div>
              ))}
            </div>
          </div>
        ))}

        {/* CHARTS — bar + pie side by side */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Bar / Line / Mixed */}
          <div className="bg-card border rounded-xl p-5">
            <h3 className="font-semibold text-sm mb-1">{activePD.amtCols.map(c=>c.name).join(" vs ")} — by {activePD.xCol||"Row"}</h3>
            <p className="text-xs text-muted-foreground mb-4">{activePD.chartRows.length} data points</p>
            {chartMode==="pie" ? renderChart(activePD,"bar") : renderChart(activePD,chartMode)}
          </div>
          {/* Always show pie on right */}
          <div className="bg-card border rounded-xl p-5">
            <h3 className="font-semibold text-sm mb-1">Distribution</h3>
            <p className="text-xs text-muted-foreground mb-4">Share per entry</p>
            {renderChart(activePD,"pie")}
          </div>
        </div>

        {/* DATA TABLE */}
        <div className="bg-card border rounded-xl overflow-hidden">
          <div className="px-5 py-3 border-b flex items-center justify-between">
            <h3 className="font-semibold text-sm">Data Table</h3>
            <span className="text-xs text-muted-foreground">{activePD.chartRows.length} rows · {sym} {cur}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-muted/50">
                  <th className="text-left px-4 py-2.5 font-semibold text-muted-foreground">{activePD.xCol||"Row"}</th>
                  {activePD.amtCols.map(c=><th key={c.id} className="text-right px-4 py-2.5 font-semibold text-muted-foreground">{c.name}</th>)}
                </tr>
              </thead>
              <tbody>
                {activePD.chartRows.map((r,i)=>(
                  <tr key={i} className={i%2===0?"bg-white":"bg-muted/20"}>
                    <td className="px-4 py-2 font-medium">{r.name}</td>
                    {activePD.amtCols.map(c=><td key={c.id} className="px-4 py-2 text-right text-primary font-medium">{formatCurrency(r[c.name]??0,cur)}</td>)}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-blue-50 font-bold border-t-2 border-blue-200">
                  <td className="px-4 py-2.5 text-blue-700">Total</td>
                  {activePD.stats.map(s=><td key={s.col.id} className="px-4 py-2.5 text-right text-blue-700">{formatCurrency(s.total,cur)}</td>)}
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      </>)}
    </div>
  );
}
