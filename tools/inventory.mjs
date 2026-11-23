import {readFile,readdir,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {parse} from 'acorn';

const root=fileURLToPath(new URL('../',import.meta.url)),marker='<!-- source inventory -->';
const excluded=new Set(['node_modules','InfoTemp','__pycache__','test-results','playwright-report']);
const tick=value=>'\x60'+String(value).replaceAll('\x60',"'")+'\x60';

async function listFiles(folder='') {
  const result=[];
  for(const f of await readdir(join(root,folder),{withFileTypes:true})){
    if(excluded.has(f.name)||(f.isDirectory()&&f.name.startsWith('.')&&f.name!=='.github'))continue;
    const path=folder?folder+'/'+f.name:f.name;
    if(f.isDirectory())result.push(...await listFiles(path));
    else if(f.isFile()&&!f.name.endsWith('.pyc'))result.push(path);
  }
  return result.sort();
}
function signature(node,source) {
  const params=node.params.map(p=>source.slice(p.start,p.end).replace(/\s+/g,' ')).join(', ');
  return '('+params+')';
}
function jsFunctions(source) {
  const ast=parse(source,{ecmaVersion:'latest',sourceType:'module',locations:true});
  const result=[];
  function visit(node,parent,owner='module') {
    if(!node||typeof node.type!=='string')return;
    let next=owner;
    if(['FunctionDeclaration','FunctionExpression','ArrowFunctionExpression'].includes(node.type)){
      let name=node.id?.name;
      if(!name&&parent?.type==='VariableDeclarator')name=parent.id.name;
      if(!name&&['Property','MethodDefinition'].includes(parent?.type))name=parent.key?.name;
      if(!name&&parent?.type==='AssignmentExpression')name=source.slice(parent.left.start,parent.left.end).split('.').at(-1);
      if(!name&&parent?.type==='CallExpression'){
        if(parent.callee.name==='test'&&parent.arguments[0]?.type==='Literal')name='test '+parent.arguments[0].value;
        else name=(parent.callee.property?.name||parent.callee.name||'call')+' callback';
      }
      name=name||'callback';
      next=(owner==='module'?'':owner+' / ')+name;
      result.push({line:node.loc.start.line,name:next+signature(node,source)});
    }
    for(const [key,child] of Object.entries(node)){
      if(['loc','start','end'].includes(key))continue;
      if(Array.isArray(child))child.forEach(item=>visit(item,node,next));
      else if(child&&typeof child==='object')visit(child,node,next);
    }
  }
  visit(ast,null);
  return result;
}
function pythonFunctions(paths) {
  const program=[
    'import ast,json,sys,pathlib',
    'result={}',
    'def visit(node,names,entries):',
    '    if isinstance(node,ast.ClassDef): names=[*names,node.name]',
    '    if isinstance(node,(ast.FunctionDef,ast.AsyncFunctionDef,ast.Lambda)):',
    '        names=[*names,getattr(node,"name","lambda")]',
    '        entries.append({"line":node.lineno,"name":" / ".join(names)+"("+ast.unparse(node.args)+")"})',
    '    for child in ast.iter_child_nodes(node): visit(child,names,entries)',
    'for path in sys.argv[1:]:',
    '    entries=[]',
    '    visit(ast.parse(pathlib.Path(path).read_text("utf-8")),[],entries)',
    '    result[path]=entries',
    'print(json.dumps(result,ensure_ascii=True))'
  ].join('\n');
  return JSON.parse(execFileSync(process.platform==='win32'?'python':'python3',['-c',program,...paths],{cwd:root,encoding:'utf8'}));
}
function fileRole(path) {
  if(path==='tests/fixtures/uk217329.pdf')return 'Unmodified UK fisheries regulation used to verify real national PDF bytes and cross-origin passage selection.';
  if(path.startsWith('tests/fixtures/gb-2020-501'))return 'Crown copyright UK legislation under the Open Government Licence. The as-made edition and the revised body and schedules support the 41-provision browser comparison.';
  if(path.includes('/sections/'))return 'Verified excerpt from the named original edition and provision.';
  if(path.startsWith('site/pdf/colreg-')&&!['site/pdf/colreg-un.pdf','site/pdf/colreg-usbook.pdf'].includes(path))return 'Verified original excerpt of the international collision regulations. The flag folio supplies the source and numbered rule.';
  if(path.startsWith('site/pdf/mlc-')&&!path.includes('consolidated'))return 'Cropped English ILO source passage. Its dated flag records point to the full original and documented treaty action.';
  if(path.startsWith('site/pdf/solas-')&&path!=='site/pdf/solas-original.pdf'&&path!=='site/pdf/solas-un.pdf')return 'SOLAS Chapter I source PDF identified in the manifest as the UN treaty publication or a measured passage from it.';
  if(path.startsWith('site/pdf/eu-')&&!path.endsWith('-oj.pdf'))return 'Verified Official Journal passage, edition and section identified by the folio.';
  if(path.startsWith('site/pdf/'))return 'Publisher PDF verified against the digest stored in its source manifest.';
  if(path.startsWith('site/data/gazette-search-'))return 'Immutable token postings keyed to the release manifest’s record ordinals.';
  if(path.startsWith('site/data/gazette-'))return 'Immutable body shard. The suffix identifies the SHA-256 prefix of its bytes.';
  if(path.startsWith('site/vendor/'))return 'Upstream distribution or bundled decoding resource. Release, integrity and licences appear in tools/vendor.mjs and site/vendor/LICENSES.txt.';
  const dataRoles={
    'boat-fields':'Small first-load index of source-defined controls and the release date. Verified against all six folio manifests.',
    'countries':'UN M49 country and territory names and codes with available ILO profiles.',
    'flag-sources':'UNCTAD ranking and reviewed flag administrations with national legislative sources.',
    'registry-guides':'Cited passages and page numbers at five flag administrations, original PDF hashes, printed date precision and scope questions.',
    'imo-history':'Treaty chronologies, resolution evidence, status notes and a country-by-instrument participation matrix.',
    'uk-history':'UK instrument IDs, published PDF identities and original or dated edition links extracted from official legislation metadata.',
    'eu-history':'EU shipping directory concepts, acts, CELEX identifiers, consolidated editions and directed legal change relationships.',
    'world-laws':'FAOLEX national records with original title, language, jurisdiction, subjects, recorded dates, repeal indicator and publisher links.',
    'originals':'Original archive PDF digests and physical extraction bounds tied to immutable section ordinals.',
    'gazette':'Norwegian source metadata, record identities, section counts, published dates and the filenames of searchable body shards.'
  };
  const dataset=path.match(/^site\/data\/([\w-]+)\.json$/)?.[1];
  if(dataRoles[dataset])return dataRoles[dataset];
  if(dataset==='folios'||dataset?.endsWith('-folios'))return 'Mapped instruments, published editions, conditions, section excerpts, source-backed field definitions and documented comparison pairs.';
  if(path.endsWith('.json'))return 'Structured catalogue, release configuration or dependency record. See the data contracts and build sections.';
  if(path.endsWith('.yml'))return 'Actions entry point. Job dependencies, permissions and publish conditions are defined in the release section.';
  if(path.endsWith('.html'))return 'Static HTML landmarks, reader workspace, filter controls, dialogs and module entry point.';
  if(path.endsWith('.css'))return 'Layout, input and focus states, print and narrow-screen rules.';
  if(path==='README.md')return 'Reader guide and link to the live site.';
  if(path==='PLAN.md')return 'Design, evidence policy, delivery sequence and reproducible file and function inventory.';
  return ({'.gitattributes':'Repository line-ending policy.','.gitignore':'Excludes dependency caches, personal material and local test output.','.nojekyll':'Static publication marker.'})[path]||'Repository source.';
}
async function inventory() {
  const files=await listFiles();
  const markdown=files.filter(f=>/\.md$/i.test(f));
  if(!['README.md','PLAN.md|README.md'].includes(markdown.join('|')))throw Error('Unexpected project Markdown files: '+markdown.join(', '));
  const own=files.filter(f=>!f.startsWith('site/vendor/')&&/\.(js|mjs|py)$/.test(f));
  const python=pythonFunctions(own.filter(f=>f.endsWith('.py')));
  const lines=[marker,'','## Exact source inventory','','Generated from the release tree. Every authored function, nested helper, event handler and inline callback appears under its file with its source line. A slash identifies the enclosing function. Third-party library internals are identified by their upstream release.','','### Authored code',''];
  for(const path of own){
    const entries=python[path]||jsFunctions(await readFile(join(root,path),'utf8'));
    lines.push('#### '+tick(path),'');
    if(entries.length)for(const f of entries)lines.push('- L'+f.line+' '+tick(f.name));
    else lines.push('Module-level declarations only.');
    lines.push('');
  }
  lines.push('### Configuration, publications and data','','Every remaining path and its role follow.','','| File | Role |','| --- | --- |');
  for(const path of files.filter(f=>!own.includes(f)))lines.push('| '+tick(path)+' | '+fileRole(path)+' |');
  return lines.join('\n')+'\n';
}
const filename=join(root,'PLAN.md');
const ledger=await inventory();
let current;
try{
  current=(await readFile(filename,'utf8')).replace(/\r\n/g,'\n');
}catch(error){
  if(error.code!=='ENOENT')throw error;
}
if(current===undefined){
  console.log('Verified the project files and authored functions.');
}else{
  const header=current.split(marker)[0].trimEnd();
  const next=header+'\n\n'+ledger;
  if(process.argv.includes('--check')){
    if(current!==next)throw Error('PLAN.md is out of date. Run npm run inventory.');
    console.log('Plan inventory matches all project files and authored functions.');
  }else if(current!==next){await writeFile(filename,next,'utf8');console.log('Updated the source inventory in PLAN.md.');}
}
