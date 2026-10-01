const API = localStorage.getItem("leipzig_api") || "http://127.0.0.1:8000/api";
let token = localStorage.getItem("leipzig_token");
let authMode = "login";
let localProgress = JSON.parse(localStorage.getItem("leipzig_progress") || "{}");

const studyTasks = [
  ["study.01","Определить 2–4 подходящие программы","Сравнить Informatik / Wirtschaftsinformatik и языки обучения."],
  ["study.02","Проверить Hochschulzugang","Понять, даёт ли твой российский аттестат/учёба в СФУ прямой доступ и нужна ли дополнительная процедура."],
  ["study.03","Довести немецкий до требуемого уровня","Для конкретной программы смотри именно её языковой сертификат и уровень."],
  ["study.04","Подготовить документы","Аттестат, приложение, документы СФУ, переводы/заверения — только по актуальному списку."],
  ["study.05","Проверить способ подачи","Некоторые заявки идут через uni-assist, другие — напрямую через портал вуза."],
  ["study.06","Отправить заявку до дедлайна","Сохрани подтверждение подачи и следи за статусом."],
  ["study.07","Получить admission / Zulassung","После допуска перейти к визовой части."],
  ["study.08","Подготовить финансовое обеспечение","Сверить сумму и допустимые способы подтверждения на дату подачи."],
  ["study.09","Оформить визу","Использовать официальный Visa Navigator/Consular Services Portal."],
  ["study.10","Приехать и оформить регистрацию/ВНЖ","После въезда выполнить требования города и Ausländerbehörde."]
];

function saveLocal(){localStorage.setItem("leipzig_progress",JSON.stringify(localProgress))}
async function api(path, opts={}){
  const headers={"Content-Type":"application/json",...(opts.headers||{})};
  if(token) headers.Authorization=`Bearer ${token}`;
  const r=await fetch(API+path,{...opts,headers});
  if(!r.ok) throw new Error((await r.json().catch(()=>({detail:"Ошибка"}))).detail||"Ошибка");
  return r.json();
}
function checked(id){return !!localProgress[id]}
async function setTask(id, done){
  localProgress[id]=done; saveLocal(); renderProgress();
  if(token){try{await api("/progress",{method:"PUT",body:JSON.stringify({item_id:id,done})})}catch(e){console.warn(e)}}
}
function renderStudy(){
  document.querySelector("#studyTasks").innerHTML=studyTasks.map(([id,t,d])=>`<label class="task"><input type="checkbox" data-task="${id}" ${checked(id)?"checked":""}><span><b>${t}</b><p>${d}</p></span></label>`).join("");
}
function renderProgress(){
  const all=[...document.querySelectorAll("[data-task]")];
  const done=Object.values(localProgress).filter(Boolean).length;
  const total=Math.max(all.length,1);
  document.querySelector("#overall").textContent=Math.min(100,Math.round(done/total*100))+"%";
  document.querySelector("#tasks").textContent=`${done}/${total}`;
}
function levels(id, current, setter){
  const vals=id==="de"?["A0","A1","A2","B1","B2","C1"]:["A1","A2","B1","B2","C1"];
  return vals.map(v=>`<button class="${v===current?"active":""}" data-level="${id}" data-value="${v}">${v}</button>`).join("");
}
let profile={german_level:"A0",english_level:"A1"};
function renderLang(){
  document.querySelector("#deLevels").innerHTML=levels("de",profile.german_level);
  document.querySelector("#enLevels").innerHTML=levels("en",profile.english_level);
  const de=["A0","A1","A2","B1","B2","C1"].indexOf(profile.german_level);
  const en=["A1","A2","B1","B2","C1"].indexOf(profile.english_level);
  document.querySelector("#debar").style.width=((de/5)*100)+"%";
  document.querySelector("#enbar").style.width=((en/4)*100)+"%";
  document.querySelector("#de").textContent=profile.german_level;
  document.querySelector("#en").textContent=profile.english_level;
}
async function loadMe(){
  if(!token){document.querySelector("#authBox").classList.remove("hidden");document.querySelector("#profileBox").classList.add("hidden");return}
  try{
    const me=await api("/me"); document.querySelector("#authBox").classList.add("hidden");document.querySelector("#profileBox").classList.remove("hidden");
    document.querySelector("#userEmail").textContent=me.email; profile=me.profile||profile;
    Object.assign(localProgress,me.progress||{});saveLocal();
    document.querySelector("#profileDe").value=profile.german_level||"A0";document.querySelector("#profileEn").value=profile.english_level||"A1";
    document.querySelector("#profileProgram").value=profile.target_program||"Informatik";document.querySelector("#profileCity").value=profile.target_city||"Leipzig";
    renderLang();renderProgress();
  }catch(e){token=null;localStorage.removeItem("leipzig_token");loadMe()}
}
document.addEventListener("click",async e=>{
  const nav=e.target.closest("[data-view]");
  if(nav){document.querySelectorAll(".view").forEach(x=>x.classList.remove("active"));document.querySelector("#"+nav.dataset.view).classList.add("active");document.querySelectorAll(".nav-btn").forEach(x=>x.classList.toggle("active",x.dataset.view===nav.dataset.view));window.scrollTo({top:0,behavior:"smooth"})}
  const task=e.target.closest("[data-task]");
  if(task && task.tagName==="INPUT") await setTask(task.dataset.task,task.checked);
  const lvl=e.target.closest("[data-level]");
  if(lvl){profile[lvl.dataset.level==="de"?"german_level":"english_level"]=lvl.dataset.value;renderLang();if(token)api("/profile",{method:"PUT",body:JSON.stringify({...profile,target_program:document.querySelector("#profileProgram").value,target_city:document.querySelector("#profileCity").value})}).catch(console.warn)}
});
document.querySelector("#loginTab").onclick=()=>{authMode="login";document.querySelector("#loginTab").classList.add("active");document.querySelector("#registerTab").classList.remove("active")}
document.querySelector("#registerTab").onclick=()=>{authMode="register";document.querySelector("#registerTab").classList.add("active");document.querySelector("#loginTab").classList.remove("active")}
document.querySelector("#authForm").onsubmit=async e=>{
  e.preventDefault();const msg=document.querySelector("#authMsg");msg.textContent="Загрузка...";
  try{const data=await api(authMode==="login"?"/auth/login":"/auth/register",{method:"POST",body:JSON.stringify({email:email.value,password:password.value})});token=data.access_token;localStorage.setItem("leipzig_token",token);msg.textContent="";await loadMe()}catch(err){msg.textContent=err.message}
}
document.querySelector("#saveProfile").onclick=async()=>{
  profile={...profile,german_level:profileDe.value,english_level:profileEn.value,target_program:profileProgram.value,target_city:profileCity.value};
  await api("/profile",{method:"PUT",body:JSON.stringify(profile)});renderLang();
}
document.querySelector("#logout").onclick=()=>{token=null;localStorage.removeItem("leipzig_token");loadMe()}
renderStudy();renderLang();loadMe();renderProgress();
