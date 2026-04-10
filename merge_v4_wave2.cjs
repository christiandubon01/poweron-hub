const{execSync:x}=require("child_process");
const b=["ht5","ht6","ht7","si1","si2","si3","si4","st1","st2","st3"];
const o={cwd:".",encoding:"utf8",stdio:"pipe"};
let m=0;
for(const n of b){
  process.stdout.write(n+"... ");
  try{
    x("git merge origin/"+n+" --no-ff -m \"integrate: "+n.toUpperCase()+"\"",o);
    console.log("clean");m++;
  }catch(e){
    try{
      const files=x("git diff --name-only --diff-filter=U",o).split("\n").filter(f=>f.trim());
      files.forEach(f=>{x("git checkout --theirs \""+f+"\"",o);x("git add \""+f+"\"",o)});
      x("git commit --no-edit",o);
      console.log("resolved");m++;
    }catch(e2){console.log("CONFLICT");x("git merge --abort",o)}
  }
}
console.log("\nMerged: "+m);
if(m>0){console.log("Building...");try{x("npm run build",o);console.log("BUILD PASSED")}catch(e){console.log("BUILD FAILED - checking errors...");try{const err=x("npx tsc --noEmit 2>&1",o);console.log(err)}catch(e3){console.log(e3.stdout||e3.message)}}}
