const express = require("express");
const path = require("path");
const fs = require("fs");
const ExcelJS = require("exceljs");
const { Pool } = require("pg");

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_KEY = process.env.ADMIN_KEY || "BIOPACK2026";
const DATA_FILE = path.join(__dirname, "biopack_results.json");

let pool = null;
if (process.env.DATABASE_URL) {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
}

const questions = [
  {context:"BioPack recibe dos propuestas para entrar a España. Un distribuidor ofrece acceso rápido a clientes, pero pide exclusividad por 18 meses. Tres compradores ofrecen iniciar con un pedido piloto, sin exclusividad y con menor volumen.",q:"¿Qué debería hacer BioPack?",opts:["Aceptar el distribuidor para entrar rápidamente al mercado.","Iniciar el piloto para conocer el mercado antes de comprometerse.","Negociar con el distribuidor una exclusividad más corta y condicionada a resultados.","Esperar hasta conocer mejor el mercado antes de elegir."],scores:[3,4,5,2]},
  {context:"Un competidor europeo ofrece un producto similar 15 % más barato. BioPack no puede igualar ese precio. Sin embargo, algunos compradores españoles valoran productos con beneficios ambientales demostrables.",q:"¿Cómo debería competir BioPack?",opts:["Reducir parcialmente el precio para acercarse al competidor.","Mantener el precio y fortalecer la comunicación sobre sostenibilidad.","Enfocarse en clientes que valoren la sostenibilidad y demostrar ese beneficio.","Mantener el producto y esperar a ganar reconocimiento en el mercado."],scores:[3,4,5,2]},
  {context:"BioPack puede hacer una sola inversión antes de ampliar sus operaciones en España. Los clientes han pedido adaptar el producto y también solicitan evidencia de sus beneficios ambientales.",q:"¿Dónde debería invertir primero?",opts:["Publicidad para aumentar el reconocimiento de la marca.","Adaptación del producto al mercado español.","Certificaciones y evidencia de los beneficios ambientales.","Fortalecimiento de la logística y distribución."],scores:[2,5,4,3]},
  {context:"Un restaurante español le dice a BioPack: “El producto es sostenible, pero también necesito que funcione bien y que las entregas sean confiables”.",q:"¿Qué debería priorizar BioPack en su propuesta?",opts:["Destacar principalmente la sostenibilidad del producto.","Ofrecer un precio inicial más bajo.","Adaptar la solución a las necesidades del restaurante y garantizar su desempeño.","Destacar el origen colombiano y la innovación de BioPack."],scores:[4,2,5,3]},
  {context:"BioPack ya está negociando con un distribuidor español. El distribuidor ofrece un pedido importante, pero exige exclusividad durante 18 meses. Al mismo tiempo, otro cliente español está interesado en comprar directamente a BioPack, pero todavía no confirma el volumen.",q:"BioPack debe tomar una decisión inmediata. ¿Qué debería hacer?",opts:["Aceptar la exclusividad, porque asegura un volumen de ventas desde el inicio.","Rechazar la exclusividad y trabajar con ambos clientes, aunque el pedido inicial sea menor.","Negociar la exclusividad por un periodo corto, condicionada al cumplimiento de un volumen mínimo y a una revisión posterior.","Esperar a que el segundo cliente confirme su volumen antes de tomar una decisión."],scores:[4,3,5,2]}
];

function readData(){try{return JSON.parse(fs.readFileSync(DATA_FILE,"utf8"));}catch(e){return [];}}
function writeData(data){fs.writeFileSync(DATA_FILE,JSON.stringify(data,null,2),"utf8");}
function sortData(data){return data.sort((a,b)=>b.score-a.score||a.elapsed-b.elapsed);}

async function initDb(){
  if(!pool) return;
  await pool.query(`CREATE TABLE IF NOT EXISTS attempts (
    id TEXT PRIMARY KEY,
    team TEXT NOT NULL UNIQUE,
    student1 TEXT NOT NULL,
    student2 TEXT NOT NULL,
    answers JSONB NOT NULL DEFAULT '[]'::jsonb,
    score INTEGER NOT NULL DEFAULT 0,
    elapsed INTEGER NOT NULL DEFAULT 0,
    started_at TIMESTAMPTZ NOT NULL,
    finished_at TIMESTAMPTZ,
    status TEXT NOT NULL DEFAULT 'En curso'
  )`);
}

async function getAll(){
  if(!pool) return readData();
  const r=await pool.query(`SELECT id,team,student1,student2,answers,score,elapsed,started_at,finished_at,status FROM attempts ORDER BY score DESC, elapsed ASC`);
  return r.rows;
}

app.use(express.json({limit:"100kb"}));
app.use(express.static(path.join(__dirname,"public")));

app.get("/api/questions",(req,res)=>res.json(questions.map(x=>({context:x.context,q:x.q,opts:x.opts}))));

app.post("/api/start",async(req,res)=>{
  try{
    const {team,student1,student2}=req.body||{};
    if(!team||!student1||!student2)return res.status(400).json({error:"Completa los tres datos."});
    const t=team.trim();
    if(pool){
      const exists=await pool.query("SELECT id FROM attempts WHERE LOWER(team)=LOWER($1)", [t]);
      if(exists.rowCount)return res.status(409).json({error:"Ese nombre de equipo ya está registrado."});
    } else {
      const data=readData();
      if(data.some(x=>x.team.toLowerCase()===t.toLowerCase()))return res.status(409).json({error:"Ese nombre de equipo ya está registrado."});
    }
    const row={id:Date.now().toString(),team:t,student1:student1.trim(),student2:student2.trim(),answers:[],score:0,elapsed:0,started_at:new Date().toISOString(),finished_at:null,status:"En curso"};
    if(pool){
      await pool.query(`INSERT INTO attempts(id,team,student1,student2,answers,score,elapsed,started_at,status) VALUES($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9)`,[row.id,row.team,row.student1,row.student2,JSON.stringify(row.answers),0,0,row.started_at,row.status]);
    } else {const data=readData();data.push(row);writeData(data);}
    res.json({id:row.id,startedAt:row.started_at});
  }catch(e){console.error(e);res.status(500).json({error:"No fue posible iniciar el equipo."});}
});

app.post("/api/submit",async(req,res)=>{
  try{
    const {id,answers}=req.body||{};
    if(!Array.isArray(answers)||answers.length!==5||answers.some(x=>![0,1,2,3].includes(x)))return res.status(400).json({error:"Respuestas incompletas."});
    let row;
    if(pool){
      const r=await pool.query("SELECT * FROM attempts WHERE id=$1",[id]);
      row=r.rows[0];
    } else {row=readData().find(x=>x.id===id);}
    if(!row)return res.status(404).json({error:"Intento no encontrado."});
    if(row.status!=="En curso")return res.status(409).json({error:"Este intento ya fue cerrado."});
    const now=Date.now();
    const elapsed=Math.max(0,Math.round((now-new Date(row.started_at).getTime())/1000));
    const score=answers.reduce((s,a,i)=>s+questions[i].scores[a],0);
    const status=elapsed>180?"Tiempo agotado":"Finalizado";
    const finishedAt=new Date(now).toISOString();
    if(pool){
      await pool.query(`UPDATE attempts SET answers=$1::jsonb,score=$2,elapsed=$3,finished_at=$4,status=$5 WHERE id=$6`,[JSON.stringify(answers),score,elapsed,finishedAt,status,id]);
    } else {
      const data=readData();const local=data.find(x=>x.id===id);Object.assign(local,{answers,score,elapsed,finished_at:finishedAt,status});writeData(data);
    }
    res.json({ok:true});
  }catch(e){console.error(e);res.status(500).json({error:"No fue posible guardar el resultado."});}
});

function auth(req,res,next){const key=req.headers["x-admin-key"]||req.query.key;if(key!==ADMIN_KEY)return res.status(401).json({error:"No autorizado"});next();}
app.get("/admin",(req,res)=>res.sendFile(path.join(__dirname,"public","admin.html")));

app.get("/api/results",auth,async(req,res)=>{try{const data=sortData(await getAll());res.json(data.map((r,i)=>({...r,position:i+1})));}catch(e){res.status(500).json({error:"No fue posible consultar resultados."});}});

app.get("/api/export",auth,async(req,res)=>{
  try{
    const data=sortData(await getAll());
    const wb=new ExcelJS.Workbook();
    const c=wb.addWorksheet("Clasificación");
    c.addRow(["Posición","Equipo","Estudiante 1","Estudiante 2","Puntaje","Tiempo (seg)","Estado","Inicio","Finalización"]);
    data.forEach((r,i)=>c.addRow([i+1,r.team,r.student1,r.student2,r.score,r.elapsed,r.status,r.started_at,r.finished_at||""]));
    const a=wb.addWorksheet("Respuestas");
    a.addRow(["Equipo","Estudiante 1","Estudiante 2","Q1","Q2","Q3","Q4","Q5","Puntaje","Tiempo (seg)","Estado","Inicio","Finalización"]);
    data.forEach(r=>{const ans=Array.isArray(r.answers)?r.answers:[];a.addRow([r.team,r.student1,r.student2,...ans.map(v=>Number(v)+1),r.score,r.elapsed,r.status,r.started_at,r.finished_at||""]);});
    res.setHeader("Content-Type","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition",'attachment; filename="BioPack_Resultados.xlsx"');
    await wb.xlsx.write(res);res.end();
  }catch(e){console.error(e);res.status(500).json({error:"No fue posible exportar resultados."});}
});

app.post("/api/reset",auth,async(req,res)=>{
  try{
    if(pool) await pool.query("TRUNCATE TABLE attempts");
    else writeData([]);
    res.json({ok:true,message:"Las pruebas de ensayo fueron eliminadas."});
  }catch(e){res.status(500).json({error:"No fue posible borrar las pruebas."});}
});

initDb().then(()=>app.listen(PORT,"0.0.0.0",()=>console.log(`BioPack activo en puerto ${PORT}`))).catch(err=>{console.error("No se pudo iniciar la base de datos",err);process.exit(1);});
