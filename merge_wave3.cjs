const{execSync}=require("child_process");
const branches=["nw63","nw64","nw65","nw66","nw67","nw68","nw69","nw70","nw71","nw72","nw73","nw74","nw75","nw76","nw77","nw78"];
const cwd="C:\\Users\\chris\\Desktop\\Power On Hub\\Power On Solutions APP - CoWork";
const git=(c)=>{try{return{ok:true,out:execSync(c,{cwd,encoding:"utf8",stdio:"pipe"}).trim()}}catch(e){return{ok:false,out:(e.stderr||"").trim()}}};
git("git fetch origin");
let m=0,f=0;
for(const b of branches){
  process.stdout.write(b+"... ");
  const r=git("git merge origin/"+b+" --no-ff -m \"integrate: "+b.toUpperCase()+"\"");
  if(r.ok){console.log("clean");m++}
  else{
    const cf=git("git diff --name-only --diff-filter=U");
    if(cf.ok&&cf.out.split("\n").every(x=>x.startsWith("dist/"))){
      cf.out.split("\n").filter(x=>x).forEach(x=>{git("git checkout --theirs \""+x+"\"");git("git add \""+x+"\"")});
      git("git commit --no-edit");
      console.log("dist resolved");m++
    }else{console.log("CONFLICT");git("git merge --abort");f++}
  }
}
console.log("\nMerged: "+m+" Failed: "+f);
if(m>0){console.log("Building...");const b=git("npm run build");console.log(b.ok?"BUILD PASSED":"BUILD FAILED")}
