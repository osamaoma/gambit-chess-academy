#!/usr/bin/env node
/**
 * bake_explorer_stats.js — bake Opening Explorer move statistics into a local
 * file so the in-app Explorer works INSTANTLY with NO token and NO internet.
 *
 * What it does:
 *   - Walks every position along every opening line in public/openings_data.json
 *     (each ply = one position).
 *   - For each unique position, queries the Lichess opening explorer ONCE for the
 *     move popularity + white/draw/black win counts.
 *   - Writes them to public/explorer_stats.json keyed by the UCI play string.
 *
 * After running this once, the app's Explorer reads these baked stats locally.
 * Users never need a token. (A token IS needed to RUN this bake, because Lichess
 * now requires auth for the explorer — but only here, one time, on your machine.)
 *
 * Usage:
 *   LICHESS_TOKEN=lip_xxx node bake_explorer_stats.js
 *   LICHESS_TOKEN=lip_xxx node bake_explorer_stats.js --db lichess --max 4
 *
 * Options:
 *   --db masters|lichess   which database (default: lichess — has more games at club level)
 *   --max N                only bake the first N plies of each line (default: 12; keeps it fast)
 *   --speeds a,b           lichess speeds filter (default: blitz,rapid,classical)
 *   --ratings a,b          lichess rating bands (default: none = all)
 *
 * Get a free token (no scopes needed): https://lichess.org/account/oauth/token/create
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

// ---- args ----
function argVal(name, def){ const i = process.argv.indexOf(name); return i >= 0 && process.argv[i+1] ? process.argv[i+1] : def; }
const DB = argVal('--db', 'lichess') === 'masters' ? 'masters' : 'lichess';
const MAX_PLY = parseInt(argVal('--max', '12'), 10);
const SPEEDS = argVal('--speeds', 'blitz,rapid,classical');
const RATINGS = argVal('--ratings', '');
const RATE_MS = 600; // polite delay between requests
const TOKEN = (process.env.LICHESS_TOKEN || '').trim();

const DATA = path.join(__dirname, 'public', 'openings_data.json');
const OUT  = path.join(__dirname, 'public', 'explorer_stats.json');

if(!TOKEN){
  console.error('\n  ERROR: no LICHESS_TOKEN set.\n');
  console.error('  The Lichess opening explorer now requires a free token to query.');
  console.error('  Create one (no scopes needed) at:');
  console.error('    https://lichess.org/account/oauth/token/create?description=Gambit+bake\n');
  console.error('  Then run:  LICHESS_TOKEN=lip_xxx node bake_explorer_stats.js\n');
  process.exit(1);
}

// ---- tiny chess core: SAN -> UCI (same logic as bake_explorer.js) ----
const FILES = 'abcdefgh';
function startBoard(){ const b={}; const back=['r','n','b','q','k','b','n','r'];
  for(let i=0;i<8;i++){ b[FILES[i]+'8']='b'+back[i]; b[FILES[i]+'7']='bp'; b[FILES[i]+'2']='wp'; b[FILES[i]+'1']='w'+back[i]; } return b; }
function clone(b){ return Object.assign({},b); }
function colorAt(b,s){ return b[s]?b[s][0]:null; }
function sq(f,r){ return FILES[f]+(r+1); }
function inb(f,r){ return f>=0&&f<8&&r>=0&&r<8; }
function genFrom(b,s,turn){ const p=b[s]; if(!p||p[0]!==turn) return []; const t=p[1]; const f=FILES.indexOf(s[0]); const r=+s[1]-1; const out=[];
  const add=(tf,tr)=>{ if(!inb(tf,tr))return; const d=sq(tf,tr); if(colorAt(b,d)===turn)return; out.push(d); };
  const slide=(ds)=>{ for(const[df,dr]of ds){ let tf=f+df,tr=r+dr; while(inb(tf,tr)){ const d=sq(tf,tr); if(colorAt(b,d)===turn)break; out.push(d); if(b[d])break; tf+=df;tr+=dr; } } };
  if(t==='p'){ const dir=turn==='w'?1:-1; const st=turn==='w'?1:6;
    if(!b[sq(f,r+dir)]){ out.push(sq(f,r+dir)); if(r===st&&!b[sq(f,r+2*dir)]) out.push(sq(f,r+2*dir)); }
    for(const df of[-1,1]){ const tf=f+df,tr=r+dir; if(!inb(tf,tr))continue; const d=sq(tf,tr); if(b[d]&&colorAt(b,d)!==turn) out.push(d); else out.push(d); } }
  else if(t==='n'){ for(const[df,dr]of[[1,2],[2,1],[2,-1],[1,-2],[-1,-2],[-2,-1],[-2,1],[-1,2]]) add(f+df,r+dr); }
  else if(t==='b'){ slide([[1,1],[1,-1],[-1,1],[-1,-1]]); }
  else if(t==='r'){ slide([[1,0],[-1,0],[0,1],[0,-1]]); }
  else if(t==='q'){ slide([[1,1],[1,-1],[-1,1],[-1,-1],[1,0],[-1,0],[0,1],[0,-1]]); }
  else if(t==='k'){ for(const[df,dr]of[[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]]) add(f+df,r+dr); }
  return out;
}
function applySAN(b,san,turn){ san=san.replace(/[+#!?]+$/,'');
  if(san==='O-O'||san==='O-O-O'){ const r=turn==='w'?'1':'8'; const kf='e'+r; const kt=san==='O-O'?'g'+r:'c'+r; const rf=san==='O-O'?'h'+r:'a'+r; const rt=san==='O-O'?'f'+r:'d'+r;
    const nb=clone(b); nb[kt]=nb[kf]; delete nb[kf]; nb[rt]=nb[rf]; delete nb[rf]; return {board:nb,uci:kf+kt}; }
  let promo=null; const pm=san.match(/=([QRBN])$/); if(pm){ promo=pm[1].toLowerCase(); san=san.replace(/=([QRBN])$/,''); }
  const pieceLetter=/^[KQRBN]/.test(san)?san[0]:'P'; const t=pieceLetter==='P'?'p':pieceLetter.toLowerCase();
  const dest=san.match(/[a-h][1-8]/g); const to=dest?dest[dest.length-1]:null; if(!to) throw new Error('bad SAN '+san);
  const body=san.replace(/^[KQRBN]/,'').replace(/x/,'').replace(/[a-h][1-8]$/,'');
  let ff=null,fr=null; for(const ch of body){ if(FILES.includes(ch))ff=ch; else if('12345678'.includes(ch))fr=ch; }
  let from=null;
  for(const s2 in b){ if(b[s2][0]!==turn||b[s2][1]!==t)continue; if(ff&&s2[0]!==ff)continue; if(fr&&s2[1]!==fr)continue; if(genFrom(b,s2,turn).includes(to)){ from=s2; break; } }
  if(!from) throw new Error('no source for '+san);
  const nb=clone(b);
  if(t==='p'&&FILES.indexOf(to[0])!==FILES.indexOf(from[0])&&!b[to]){ const capR=turn==='w'?'5':'4'; delete nb[to[0]+capR]; }
  nb[to]=promo?(turn+promo):nb[from]; delete nb[from];
  return {board:nb,uci:from+to+(promo?promo:'')};
}
function sansToUci(sans){ let b=startBoard(),turn='w'; const u=[]; for(const s of sans){ const r=applySAN(b,s,turn); b=r.board; u.push(r.uci); turn=turn==='w'?'b':'w'; } return u; }

// ---- HTTP ----
function fetchJSON(url){
  return new Promise((resolve,reject)=>{
    https.get(url,{headers:{'User-Agent':'GambitBaker/1.0','Authorization':'Bearer '+TOKEN}},res=>{
      let d=''; res.on('data',c=>d+=c); res.on('end',()=>{
        if(res.statusCode===429){ return reject(new Error('429')); }
        if(res.statusCode===401){ return reject(new Error('401')); }
        try{ resolve(JSON.parse(d)); }catch(e){
          // try ndjson last line
          const lines=d.trim().split('\n').filter(Boolean);
          for(let i=lines.length-1;i>=0;i--){ try{ return resolve(JSON.parse(lines[i])); }catch(_){} }
          reject(e);
        }
      });
    }).on('error',reject);
  });
}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

function explorerUrl(playUci){
  const p=new URLSearchParams(); if(playUci) p.set('play', playUci);
  if(DB==='lichess'){ p.set('speeds',SPEEDS); if(RATINGS) p.set('ratings',RATINGS); }
  return `https://explorer.lichess.ovh/${DB}?${p.toString()}`;
}

(async ()=>{
  const data=JSON.parse(fs.readFileSync(DATA,'utf8'));
  // collect every unique UCI-prefix (position) up to MAX_PLY
  const positions=new Set();
  positions.add(''); // start position
  let skipped=0;
  for(const fam of data.families){
    for(const v of fam.v){
      let uci; try{ uci=sansToUci(v.s); }catch(e){ skipped++; continue; }
      const lim=Math.min(uci.length, MAX_PLY);
      for(let i=0;i<lim;i++){ positions.add(uci.slice(0,i).join(',')); }
      // also include the position after the last shown move within MAX_PLY
      if(lim>0) positions.add(uci.slice(0,lim).join(','));
    }
  }
  const list=[...positions];
  console.log(`Positions to bake: ${list.length} (db=${DB}, maxPly=${MAX_PLY}). ${skipped} lines skipped (SAN parse).`);
  console.log('This will take roughly', Math.ceil(list.length*RATE_MS/1000/60), 'minutes (polite rate limiting).\n');

  // resume support: load existing
  let out={}; try{ out=JSON.parse(fs.readFileSync(OUT,'utf8')).positions||{}; }catch(e){}

  let done=0, fetched=0, backoff=RATE_MS;
  for(const play of list){
    done++;
    if(out[play]){ continue; } // already baked
    let tries=0, ok=false;
    while(tries<5 && !ok){
      tries++;
      try{
        const d=await fetchJSON(explorerUrl(play));
        const moves=(d.moves||[]).map(m=>({u:m.uci,san:m.san,w:m.white||0,d:m.draws||0,b:m.black||0}));
        out[play]={moves};
        fetched++; ok=true; backoff=RATE_MS;
      }catch(e){
        if(e.message==='401'){ console.error('\n  401 Unauthorized — your token is invalid. Aborting.\n'); process.exit(1); }
        if(e.message==='429'){ backoff=Math.min(backoff*2, 30000); console.log(`  rate limited; backing off ${backoff}ms…`); await sleep(backoff); }
        else { await sleep(backoff); }
      }
    }
    await sleep(RATE_MS);
    if(done%50===0 || done===list.length){
      process.stdout.write(`  ${done}/${list.length} positions (${fetched} fetched this run)\r`);
      // periodic save
      fs.writeFileSync(OUT, JSON.stringify({db:DB,maxPly:MAX_PLY,positions:out}));
    }
  }
  fs.writeFileSync(OUT, JSON.stringify({db:DB,maxPly:MAX_PLY,generated:new Date().toISOString(),positions:out}));
  console.log(`\n\nDone. Baked ${Object.keys(out).length} positions into public/explorer_stats.json`);
  console.log('The in-app Explorer will now use these instantly, with no token.\n');
})();
