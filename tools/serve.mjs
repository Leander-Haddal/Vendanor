import http from 'node:http';
import {open,stat} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../site/',import.meta.url));
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.css':'text/css; charset=utf-8','.pdf':'application/pdf','.txt':'text/plain; charset=utf-8'};
const arg=process.argv.indexOf('--port');
const port=Number(arg===-1?(process.env.PORT||4173):process.argv[arg+1]);

async function serve(req,res) {
  try{
    if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405,{Allow:'GET, HEAD'}).end();return;}
    const url=new URL(req.url,'http://127.0.0.1');
    if(url.pathname==='/Vendanor'){res.writeHead(308,{Location:'/Vendanor/'+url.search}).end();return;}
    const path=decodeURIComponent(url.pathname).replace(/^\/Vendanor\//,'/').replace(/^\/+|\/+$/g,'')||'index.html';
    const file=resolve(root,path);
    if(!file.startsWith(resolve(root)+sep)){res.writeHead(404).end();return;}
    const info=await stat(file);
    if(!info.isFile()){res.writeHead(404).end();return;}
    res.setHeader('Content-Type',types[extname(file)]||'application/octet-stream');
    res.setHeader('Content-Length',info.size);
    if(req.method==='HEAD'){res.end();return;}
    const handle=await open(file);
    const stream=handle.createReadStream();res.once('close',()=>stream.destroy());stream.on('error',()=>res.destroy());stream.pipe(res);
  }catch{if(!res.headersSent)res.writeHead(404);res.end();}
}
http.createServer(serve).listen(port,'127.0.0.1',()=>console.log('Ship Law Index at http://127.0.0.1:'+port+'/Vendanor/'));
