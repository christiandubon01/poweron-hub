const{execSync:x}=require("child_process");
const b=["v4-st3","v4-cp2","v4-ob1","v4-ob2","ht3","ht4"];
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
    }catch(e2){
      try{
        const files=x("git diff --name-only --diff-filter=U",o).split("\n").filter(f=>f.trim());
        files.forEach(f=>{x("git checkout --theirs \""+f+"\"",o);x("git add \""+f+"\"",o)});
        x("git commit --no-edit",o);
        console.log("resolved (theirs)");m++;
      }catch(e3){console.log("CONFLICT - manual");x("git merge --abort",o)}
    }
  }
}
console.log("\nMerged: "+m);
if(m>0){console.log("Building...");try{x("npm run build",o);console.log("BUILD PASSED")}catch(e){console.log("BUILD FAILED")}}
