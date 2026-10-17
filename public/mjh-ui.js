/* Presentation-only enhancement. Does not intercept or rewrite API calls. */
(()=>{
 const app=document.getElementById('app'),main=document.getElementById('main'),login=document.getElementById('login');
 const pageNames={overview:'工作总览',schedule:'发文排程',media:'素材库',bot:'机器人设置',staff:'员工与权限',log:'操作记录'};
 const qs=s=>document.querySelector(s);
 qs('#mobileOpen')?.addEventListener('click',()=>{app.classList.toggle('menu-open');qs('#mobileOpen').setAttribute('aria-expanded',app.classList.contains('menu-open'));});
 function closeMenu(){if(app.classList.contains('menu-open'))app.classList.remove('menu-open');qs('#mobileOpen')?.setAttribute('aria-expanded','false');}
 qs('.workspace-shade')?.addEventListener('click',closeMenu);
 qs('#nav')?.addEventListener('click',closeMenu);
 document.addEventListener('keydown',e=>{if(e.key==='Escape')closeMenu();});
 qs('#showPassword')?.addEventListener('click',()=>{const input=qs('#pw');const show=input.type==='password';input.type=show?'text':'password';qs('#showPassword').setAttribute('aria-label',show?'隐藏密码':'显示密码');qs('#showPassword').setAttribute('aria-pressed',String(show));});
 function locationUI(){const page=location.hash.slice(1);const key=pageNames[page]?page:'overview';main.dataset.uiPage=key;main.className='page-'+key;qs('#breadcrumb').textContent=pageNames[key];document.title=pageNames[key]+' · MJH Desk';closeMenu();}
 window.addEventListener('hashchange',locationUI);locationUI();
 function setClock(){qs('#workspaceDate').textContent=new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Kuala_Lumpur',month:'long',day:'numeric',weekday:'long'}).format(new Date());}setClock();
 const clockTimer=setInterval(setClock,60000);window.addEventListener('pagehide',()=>clearInterval(clockTimer));
 function ready(){if(!login.classList.contains('hide')||!app.classList.contains('hide')){qs('#initialLoading')?.remove();}if(!login.classList.contains('hide')){qs('#modalRoot').innerHTML='';closeMenu();}}
 new MutationObserver(ready).observe(app,{attributes:true,attributeFilter:['class']});new MutationObserver(ready).observe(login,{attributes:true,attributeFilter:['class']});ready();
 function enhance(){
   main.querySelectorAll('table').forEach(t=>{if(!t.parentElement.classList.contains('table-scroll')){const wrap=document.createElement('div');wrap.className='table-scroll';wrap.tabIndex=0;wrap.setAttribute('aria-label','数据列表，可横向滚动');t.before(wrap);wrap.append(t);}});
   document.querySelectorAll('#nav a,.tabs a').forEach(a=>{a.tabIndex=0;a.setAttribute('role','button');a.setAttribute('aria-current',a.classList.contains('on')?'page':'false');if(!a.dataset.keyReady){a.dataset.keyReady='1';a.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();a.click();}});}});
   main.querySelectorAll('tr.click').forEach(tr=>{if(!tr.dataset.keyReady){tr.tabIndex=0;tr.setAttribute('role','button');tr.dataset.keyReady='1';tr.addEventListener('keydown',e=>{if(e.key==='Enter'){tr.click();}});}});
   main.querySelectorAll('.mi img').forEach(img=>{if(!img.alt)img.alt=img.closest('.mi')?.querySelector('.nm')?.textContent||'素材预览';});
   qs('#chart svg')?.setAttribute('role','img');qs('#chart svg')?.setAttribute('aria-label','所选期间的数据趋势，鼠标停留数据点可查看数值');
 }
 new MutationObserver(enhance).observe(main,{childList:true,subtree:true});new MutationObserver(enhance).observe(qs('#nav'),{childList:true});enhance();
 window.addEventListener('unhandledrejection',e=>{if(typeof toast==='function')toast(e.reason?.message||'连接失败，请稍后重试',1);if(qs('#initialLoading')){qs('#initialLoading').remove();const box=document.createElement('div');box.className='ui-error';box.setAttribute('role','alert');const p=document.createElement('div');p.textContent='暂时无法连接后台。请确认服务已启动，再重试。';const b=document.createElement('button');b.textContent='重新连接';b.onclick=()=>location.reload();box.append(p,b);document.body.append(box);}});
})();
