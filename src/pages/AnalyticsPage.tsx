import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from "recharts";
import { TrendingUp, IndianRupee, BarChart2, PieChart as PieIcon, Table2 } from "lucide-react";

interface DbTable  { id:string; name:string; }
interface DbColumn { id:string; table_id:string; name:string; type:string; }
interface DbRow    { id:string; table_id:string; row_data:Record<string,any>; }

const COLORS=["#3b82f6","#22c55e","#f59e0b","#ef4444","#a855f7","#06b6d4","#f97316","#ec4899"];
const toNum=(v:any)=>{if(v==null||v==="")return 0;const n=Number(String(v).replace(/,/g,""));return isFinite(n)?n:0;};
const fmt=(n:number)=>`₹${n.toLocaleString("en-IN",{maximumFractionDigits:2})}`;

export default function AnalyticsPage(){
  const {profile}=useAuth();
  const uid=profile?.id;

  const [tables,setTables]=useState<DbTable[]>([]);
  const [columns,setColumns]=useState<DbColumn[]>([]);
  const [rows,setRows]=useState<DbRow[]>([]);
  const [loading,setLoading]=useState(true);
  const [chartType,setChartType]=useState<"bar"|"line"|"pie">("bar");

  useEffect(()=>{
    if(!uid)return;
    (async()=>{
      setLoading(true);
      // load all tables
      const {data:tbls}=await supabase.from("user_tables").select("id,name").eq("user_id",uid);
      const tableList=(tbls??[]) as DbTable[];
      setTables(tableList);
      if(!tableList.length){setLoading(false);return;}

      const ids=tableList.map(t=>t.id);

      // load ALL columns — filter only amount type
      const {data:cols}=await supabase.from("user_columns").select("*").in("table_id",ids);
      const amountCols=((cols??[]) as DbColumn[]).filter(c=>c.type==="amount");
      setColumns(amountCols);

      if(!amountCols.length){setLoading(false);return;}

      // load rows only for tables that have amount columns
      const relevantTableIds=[...new Set(amountCols.map(c=>c.table_id))];
      const {data:rowData}=await supabase.from("user_rows").select("*").in("table_id",relevantTableIds);
      setRows(((rowData??[]) as DbRow[]).map(r=>({...r,row_data:r.row_data??{}})));
      setLoading(false);
    })();
  },[uid]);

  // Build analytics per table per amount column
  const analytics=useMemo(()=>{
    return tables.map(table=>{
      const amtCols=columns.filter(c=>c.table_id===table.id);
      if(!amtCols.length)return null;
      const tableRows=rows.filter(r=>r.table_id===table.id);
      if(!tableRows.length)return null;

      const colStats=amtCols.map(col=>{
        const vals=tableRows.map(r=>toNum(r.row_data[col.name]));
        const total=vals.reduce((a,b)=>a+b,0);
        const avg=vals.length?total/vals.length:0;
        const max=Math.max(...vals);
        const min=Math.min(...vals.filter(v=>v!==0));
        // chart data: each row as a data point
        const chartData=tableRows.map((r,i)=>({
          name:`Row ${i+1}`,
          value:toNum(r.row_data[col.name]),
        })).filter(d=>d.value!==0);
        return {col,vals,total,avg,max,min:isFinite(min)?min:0,chartData};
      });

      return {table,colStats};
    }).filter(Boolean) as {table:DbTable;colStats:{col:DbColumn;vals:number[];total:number;avg:number;max:number;min:number;chartData:{name:string;value:number}[]}[]}[];
  },[tables,columns,rows]);

  if(loading)return(
    <div className="flex items-center justify-center h-64">
      <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full"/>
    </div>
  );

  if(!analytics.length)return(
    <div className="flex flex-col items-center justify-center h-64 text-center gap-3">
      <IndianRupee className="w-16 h-16 text-muted-foreground/20"/>
      <h3 className="text-lg font-semibold">No Amount columns found</h3>
      <p className="text-muted-foreground text-sm max-w-xs">Go to Tables, create a column and set its type to <strong>Amount (₹)</strong> — analytics will appear here automatically.</p>
    </div>
  );

  return(
    <div className="space-y-8 pb-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><TrendingUp className="w-6 h-6 text-primary"/>Analytics</h1>
          <p className="text-muted-foreground text-sm mt-0.5">Amount columns from all your sheets</p>
        </div>
        {/* Chart type switcher */}
        <div className="flex items-center gap-1 bg-muted rounded-lg p-1">
          {([["bar","Bar",BarChart2],["line","Line",TrendingUp],["pie","Pie",PieIcon]] as const).map(([k,label,Icon])=>(
            <button key={k} onClick={()=>setChartType(k)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${chartType===k?"bg-background shadow text-foreground":"text-muted-foreground hover:text-foreground"}`}>
              <Icon className="w-3.5 h-3.5"/>{label}
            </button>
          ))}
        </div>
      </div>

      {analytics.map(({table,colStats})=>(
        <div key={table.id} className="space-y-6">
          {/* Table name header */}
          <div className="flex items-center gap-2 pb-1 border-b">
            <Table2 className="w-4 h-4 text-muted-foreground"/>
            <h2 className="font-semibold text-base">{table.name}</h2>
          </div>

          {colStats.map(({col,total,avg,max,min,chartData},ci)=>(
            <div key={col.id} className="space-y-4">
              {/* Column label */}
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full" style={{background:COLORS[ci%COLORS.length]}}/>
                <span className="font-medium text-sm">{col.name}</span>
              </div>

              {/* Stat cards */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                  {label:"Total",value:fmt(total),icon:"Σ"},
                  {label:"Average",value:fmt(avg),icon:"∅"},
                  {label:"Highest",value:fmt(max),icon:"↑"},
                  {label:"Lowest",value:fmt(min),icon:"↓"},
                ].map(s=>(
                  <div key={s.label} className="bg-card border rounded-xl p-4">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs text-muted-foreground">{s.label}</span>
                      <span className="text-lg text-muted-foreground/40 font-bold leading-none">{s.icon}</span>
                    </div>
                    <p className="text-lg font-bold text-primary truncate">{s.value}</p>
                  </div>
                ))}
              </div>

              {/* Chart */}
              {chartData.length>0&&(
                <div className="bg-card border rounded-xl p-4">
                  <h3 className="text-sm font-medium mb-4 text-muted-foreground">{col.name} — per row</h3>
                  <ResponsiveContainer width="100%" height={220}>
                    {chartType==="bar"?(
                      <BarChart data={chartData} margin={{top:4,right:16,bottom:4,left:16}}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0"/>
                        <XAxis dataKey="name" tick={{fontSize:11}} tickLine={false}/>
                        <YAxis tick={{fontSize:11}} tickLine={false} axisLine={false} tickFormatter={v=>`₹${Number(v).toLocaleString("en-IN")}`}/>
                        <Tooltip formatter={(v:any)=>fmt(Number(v))} contentStyle={{fontSize:12,borderRadius:8}}/>
                        <Bar dataKey="value" fill={COLORS[ci%COLORS.length]} radius={[4,4,0,0]} name={col.name}/>
                      </BarChart>
                    ):chartType==="line"?(
                      <LineChart data={chartData} margin={{top:4,right:16,bottom:4,left:16}}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0"/>
                        <XAxis dataKey="name" tick={{fontSize:11}} tickLine={false}/>
                        <YAxis tick={{fontSize:11}} tickLine={false} axisLine={false} tickFormatter={v=>`₹${Number(v).toLocaleString("en-IN")}`}/>
                        <Tooltip formatter={(v:any)=>fmt(Number(v))} contentStyle={{fontSize:12,borderRadius:8}}/>
                        <Line type="monotone" dataKey="value" stroke={COLORS[ci%COLORS.length]} strokeWidth={2} dot={{r:3}} name={col.name}/>
                      </LineChart>
                    ):(
                      <PieChart>
                        <Pie data={chartData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={85} label={({name,value})=>`${name}: ${fmt(value)}`} labelLine={false}>
                          {chartData.map((_,i)=><Cell key={i} fill={COLORS[i%COLORS.length]}/>)}
                        </Pie>
                        <Tooltip formatter={(v:any)=>fmt(Number(v))} contentStyle={{fontSize:12,borderRadius:8}}/>
                        <Legend/>
                      </PieChart>
                    )}
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
