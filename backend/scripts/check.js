const fs=require('node:fs'); const path=require('node:path'); const {spawnSync}=require('node:child_process');
let count=0;
function walk(dir) {
 for(const item of fs.readdirSync(dir,{withFileTypes:true})) {
  if(['node_modules','.git'].includes(item.name)) continue;
  const file=path.join(dir,item.name);
  if(item.isDirectory()) walk(file);
  else if(file.endsWith('.js')) {
   const result=spawnSync(process.execPath,['--check',file],{encoding:'utf8'});
   if(result.status!==0) throw new Error(result.stderr);
   if(/@nestjs\/|require\(['"]typeorm/.test(fs.readFileSync(file,'utf8'))) throw new Error('Dependencia residual: '+file);
   count++;
  }
 }
}
walk(path.resolve(__dirname,'..')); console.log(count+' archivos JavaScript: sintaxis correcta y sin dependencias del framework anterior.');
