#!/usr/bin/env node
/**
 * bake_explorer.js — OPTIONAL one-time deepening of opening lines.
 *
 * Every variation in public/openings_data.json already has a valid mainline
 * (named theory + most-common DB continuation). This script extends any line
 * shorter than TARGET_PLY to a true 20+ ply mainline using the LIVE Lichess
 * opening Explorer (the most-played move at each step), so the lines match
 * what real players actually play.
 *
 * It is OPTIONAL. The app works fully without running this. Run it only if you
 * want maximum-depth lines and your network can reach explorer.lichess.ovh.
 *
 *   node bake_explorer.js              # deepen using masters DB (falls back to lichess)
 *   node bake_explorer.js --db lichess # use the rated-games DB instead
 *
 * It rewrites public/openings_data.json in place and sets "deepened": true.
 * A backup is written to public/openings_data.backup.json first.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const TARGET_PLY = 20;
const DATA = path.join(__dirname, 'public', 'openings_data.json');
const DB = (process.argv.includes('--db') ? process.argv[process.argv.indexOf('--db') + 1] : 'masters');
const RATE_MS = 350; // be polite to the public API

// Minimal SAN -> UCI converter using a tiny board model, so we can build the
// Explorer `play` parameter (UCI). We reuse a compact legal-move generator.
// To keep this script dependency-free we shell out to the same logic the app
// uses by re-implementing just enough: but simplest is to send FEN-free `play`
// built from UCI we derive by replaying SAN. We implement a small chess core.

// ---- tiny chess core (enough for legal opening moves) ----
const FILES = 'abcdefgh';
function startBoard() {
  const b = {};
  const back = ['r','n','b','q','k','b','n','r'];
  for (let i=0;i<8;i++){ b[FILES[i]+'8']='b'+back[i]; b[FILES[i]+'7']='bp'; b[FILES[i]+'2']='wp'; b[FILES[i]+'1']='w'+back[i]; }
  return b;
}
function clone(b){ return Object.assign({}, b); }
function colorAt(b,sq){ return b[sq]? b[sq][0] : null; }
function typeAt(b,sq){ return b[sq]? b[sq][1] : null; }
function sqFrom(f,r){ return FILES[f]+(r+1); }
function inb(f,r){ return f>=0&&f<8&&r>=0&&r<8; }

function genFrom(b, sq, turn, ep) {
  const piece = b[sq]; if(!piece||piece[0]!==turn) return [];
  const t=piece[1]; const f=FILES.indexOf(sq[0]); const r=+sq[1]-1; const out=[];
  const add=(tf,tr)=>{ if(!inb(tf,tr))return; const d=sqFrom(tf,tr); if(colorAt(b,d)===turn)return; out.push(d); };
  const slide=(dirs)=>{ for(const[df,dr]of dirs){ let tf=f+df,tr=r+dr; while(inb(tf,tr)){ const d=sqFrom(tf,tr); if(colorAt(b,d)===turn)break; out.push(d); if(b[d])break; tf+=df;tr+=dr; } } };
  if(t==='p'){ const dir=turn==='w'?1:-1; const start=turn==='w'?1:6;
    if(!b[sqFrom(f,r+dir)]){ out.push(sqFrom(f,r+dir)); if(r===start&&!b[sqFrom(f,r+2*dir)]) out.push(sqFrom(f,r+2*dir)); }
    for(const df of [-1,1]){ const tf=f+df,tr=r+dir; if(!inb(tf,tr))continue; const d=sqFrom(tf,tr); if((b[d]&&colorAt(b,d)!==turn)||d===ep) out.push(d); } }
  else if(t==='n'){ for(const[df,dr]of[[1,2],[2,1],[2,-1],[1,-2],[-1,-2],[-2,-1],[-2,1],[-1,2]]) add(f+df,r+dr); }
  else if(t==='b'){ slide([[1,1],[1,-1],[-1,1],[-1,-1]]); }
  else if(t==='r'){ slide([[1,0],[-1,0],[0,1],[0,-1]]); }
  else if(t==='q'){ slide([[1,1],[1,-1],[-1,1],[-1,-1],[1,0],[-1,0],[0,1],[0,-1]]); }
  else if(t==='k'){ for(const[df,dr]of[[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]]) add(f+df,r+dr); }
  return out;
}

// Apply a SAN move, return {board, uci, ep}. Handles castling, promotion, captures.
function applySAN(b, san, turn, ep) {
  san = san.replace(/[+#!?]+$/,'');
  // castling
  if(san==='O-O'||san==='O-O-O'){
    const r = turn==='w'?'1':'8'; const kf='e'+r;
    const kt = san==='O-O'?'g'+r:'c'+r; const rf = san==='O-O'?'h'+r:'a'+r; const rt = san==='O-O'?'f'+r:'d'+r;
    const nb=clone(b); nb[kt]=nb[kf]; delete nb[kf]; nb[rt]=nb[rf]; delete nb[rf];
    return {board:nb, uci:kf+kt, ep:null};
  }
  let promo=null; const pm=san.match(/=([QRBN])$/); if(pm){ promo=pm[1].toLowerCase(); san=san.replace(/=([QRBN])$/,''); }
  const pieceLetter = /^[KQRBN]/.test(san)? san[0] : 'P';
  const t = pieceLetter==='P'?'p':pieceLetter.toLowerCase();
  const dest = san.match(/[a-h][1-8]/g); const to = dest? dest[dest.length-1] : null;
  if(!to) throw new Error('bad SAN '+san);
  // disambiguation
  const body = san.replace(/^[KQRBN]/,'').replace(/x/,'').replace(/[a-h][1-8]$/,'');
  let fromFileHint=null, fromRankHint=null;
  for(const ch of body){ if(FILES.includes(ch)) fromFileHint=ch; else if('12345678'.includes(ch)) fromRankHint=ch; }
  // find a piece of type t that can reach `to`
  let from=null;
  for(const sq in b){ if(b[sq][0]!==turn||b[sq][1]!==t) continue;
    if(fromFileHint&&sq[0]!==fromFileHint) continue;
    if(fromRankHint&&sq[1]!==fromRankHint) continue;
    if(genFrom(b,sq,turn,ep).includes(to)){ from=sq; break; } }
  if(!from) throw new Error('no source for '+san);
  const nb=clone(b);
  let newEp=null;
  if(t==='p'&&Math.abs(+to[1]-+from[1])===2) newEp=from[0]+((+from[1]+ +to[1])/2);
  // en passant capture
  if(t==='p'&&to===ep&&!b[to]){ const capR=turn==='w'?'5':'4'; delete nb[to[0]+capR]; }
  nb[to]= promo? (turn+promo) : nb[from]; delete nb[from];
  const uci = from+to+(promo?promo:'');
  return {board:nb, uci, ep:newEp};
}

function sansToUci(sans){
  let b=startBoard(), turn='w', ep=null; const uci=[];
  for(const san of sans){ const r=applySAN(b,san,turn,ep); b=r.board; uci.push(r.uci); ep=r.ep; turn=turn==='w'?'b':'w'; }
  return uci;
}

function fetchJSON(url){
  return new Promise((resolve,reject)=>{
    https.get(url,{headers:{'User-Agent':'GambitBaker/1.0'}},res=>{
      let d=''; res.on('data',c=>d+=c); res.on('end',()=>{ try{resolve(JSON.parse(d));}catch(e){reject(e);} });
    }).on('error',reject);
  });
}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

async function topMove(uciList, db){
  const play=uciList.join(',');
  const url=`https://explorer.lichess.ovh/${db}?play=${play}`;
  try{
    const data=await fetchJSON(url);
    if(data&&data.moves&&data.moves.length){
      // most-played
      const m=data.moves.reduce((a,b)=> (b.white+b.draws+b.black)>(a.white+a.draws+a.black)?b:a);
      return {san:m.san, uci:m.uci};
    }
  }catch(e){}
  return null;
}

(async ()=>{
  const data=JSON.parse(fs.readFileSync(DATA,'utf8'));
  fs.writeFileSync(DATA.replace('.json','.backup.json'), JSON.stringify(data));
  let total=0, deepened=0;
  for(const fam of data.families){
    for(const v of fam.v){
      total++;
      if(v.s.length>=TARGET_PLY) continue;
      let sans=v.s.slice();
      let uci;
      try{ uci=sansToUci(sans); }catch(e){ continue; }
      let guard=0;
      while(sans.length<TARGET_PLY && guard<30){
        guard++;
        let mv=await topMove(uci, DB);
        if(!mv && DB!=='lichess') mv=await topMove(uci,'lichess');
        await sleep(RATE_MS);
        if(!mv) break;
        sans.push(mv.san); uci.push(mv.uci);
      }
      if(sans.length>v.s.length){ v.s=sans; deepened++; }
      if(deepened%25===0&&deepened>0) process.stdout.write(`  deepened ${deepened}...\n`);
    }
  }
  data.deepened=true;
  fs.writeFileSync(DATA, JSON.stringify(data));
  console.log(`Done. ${deepened} of ${total} variations extended toward ${TARGET_PLY} ply.`);
  console.log('Backup saved as public/openings_data.backup.json');
})();
