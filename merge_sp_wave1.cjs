const{execSync:x}=require("child_process");
const b=["sp2","sp4","sp7","sp8","sp9","sp10","sp14","sp15","sp16"];
const o={cwd:".",encoding:"utf8",stdio:"pipe"};
let m=0;
for(const n of b){
  process.stdout.write(n+"... ");
  try{
    x("git merge origin/"+n+" --no-ff -m \"integrate: "+n.toUpperCase()+"\"",o);
    console.log("clean");m++;
  }catch(e){
    try{
      x("git checkout --theirs dist/index.html",o);
      x("git add dist/",o);
      x("git commit --no-edit",o);
      console.log("dist resolved");m++;
    }catch(e2){console.log("CONFLICT");x("git merge --abort",o)}
  }
}
console.log("\nMerged: "+m);
if(m>0){console.log("Building...");try{x("npm run build",o);console.log("BUILD PASSED")}catch(e){console.log("BUILD FAILED")}}
