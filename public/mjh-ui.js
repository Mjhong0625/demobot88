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
 function locationUI(){const page=location.hash.slice(1);const key=pageNames[page]?page:'overview';main.dataset.uiPage=key;main.className='page-'+key;qs('#breadcrumb').textContent=pageNames[key];document.title=pageNames[key]+' · 品牌工作台';closeMenu();}
 window.addEventListener('hashchange',locationUI);locationUI();
 function setClock(){qs('#workspaceDate').textContent=new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Kuala_Lumpur',month:'long',day:'numeric',weekday:'long'}).format(new Date());}setClock();
 const clockTimer=setInterval(setClock,60000);window.addEventListener('pagehide',()=>clearInterval(clockTimer));
 function ready(){if(!login.classList.contains('hide')||!app.classList.contains('hide')){qs('#initialLoading')?.remove();}if(!login.classList.contains('hide')){qs('#modalRoot').innerHTML='';closeMenu();}}
 new MutationObserver(ready).observe(app,{attributes:true,attributeFilter:['class']});new MutationObserver(ready).observe(login,{attributes:true,attributeFilter:['class']});ready();
 function enhance(){
   const heading=main.querySelector('.top h1');
   if(heading?.textContent==='一切井然有序。')heading.textContent='工作总览';

   main.querySelectorAll('table').forEach(t=>{if(!t.parentElement.classList.contains('table-scroll')){const wrap=document.createElement('div');wrap.className='table-scroll';wrap.tabIndex=0;wrap.setAttribute('aria-label','数据列表，可横向滚动');t.before(wrap);wrap.append(t);}});
   document.querySelectorAll('#nav a,.tabs a').forEach(a=>{a.tabIndex=0;a.setAttribute('role','button');a.setAttribute('aria-current',a.classList.contains('on')?'page':'false');if(!a.dataset.keyReady){a.dataset.keyReady='1';a.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();a.click();}});}});
   main.querySelectorAll('tr.click').forEach(tr=>{if(!tr.dataset.keyReady){tr.tabIndex=0;tr.setAttribute('role','button');tr.dataset.keyReady='1';tr.addEventListener('keydown',e=>{if(e.key==='Enter'){tr.click();}});}});
   main.querySelectorAll('.mi img').forEach(img=>{if(!img.alt)img.alt=img.closest('.mi')?.querySelector('.nm')?.textContent||'素材预览';});
   qs('#chart svg')?.setAttribute('role','img');qs('#chart svg')?.setAttribute('aria-label','所选期间的数据趋势，鼠标停留数据点可查看数值');
 }
 new MutationObserver(enhance).observe(main,{childList:true,subtree:true});new MutationObserver(enhance).observe(qs('#nav'),{childList:true});enhance();
 window.addEventListener('unhandledrejection',e=>{if(typeof toast==='function')toast(e.reason?.message||'连接失败，请稍后重试',1);if(qs('#initialLoading')){qs('#initialLoading').remove();const box=document.createElement('div');box.className='ui-error';box.setAttribute('role','alert');const p=document.createElement('div');p.textContent='暂时无法连接后台。请确认服务已启动，再重试。';const b=document.createElement('button');b.textContent='重新连接';b.onclick=()=>location.reload();box.append(p,b);document.body.append(box);}});
})();

/* V4 keyboard and focus support; no application data or API access. */
(()=>{
 const root=document.getElementById('modalRoot');
 let active=null,previous=null;
 const focusable=box=>Array.from(box.querySelectorAll('button:not(:disabled),a[href],input:not(:disabled):not([type=hidden]),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]')).filter(el=>el.getClientRects().length);
 document.getElementById('skipMain')?.addEventListener('click',e=>{e.preventDefault();document.getElementById('main').focus();});
 new MutationObserver(()=>{
  const dialog=root.querySelector('.modal');
  if(dialog===active)return;
  if(dialog){
   if(!active)previous=document.activeElement;
   active=dialog;document.body.classList.add('ui-modal-open');
   dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');
   const heading=dialog.querySelector('h3');if(heading){heading.id=heading.id||'uiDialogTitle';dialog.setAttribute('aria-labelledby',heading.id);}
   dialog.tabIndex=-1;dialog.focus({preventScroll:true});
  }else{active=null;document.body.classList.remove('ui-modal-open');if(previous?.isConnected)previous.focus({preventScroll:true});previous=null;}
 }).observe(root,{childList:true,subtree:true});
 document.addEventListener('keydown',e=>{
  if(!active||e.key!=='Tab')return;
  const items=focusable(active),first=items[0],last=items.at(-1);
  if(!first){e.preventDefault();active.focus();return;}
  if(e.shiftKey&&(document.activeElement===first||document.activeElement===active)){e.preventDefault();last.focus();}
  else if(!e.shiftKey&&(document.activeElement===last||!active.contains(document.activeElement))){e.preventDefault();first.focus();}
 });
})();


/* Sidebar image uses the authenticated bot-avatar endpoint. */
(()=>{
 const app=document.getElementById('app'),slot=document.querySelector('.ws [data-brand-logo]');
 let visible=false,stamp='',image=null;
 function refresh(){
  if(app.classList.contains('hide'))return;
  if(image)image.remove();
  slot.classList.remove('has-logo');
  image=new Image();image.alt='机器人头像';image.hidden=true;
  const current=image;
  current.onload=()=>{if(image!==current)return;current.hidden=false;slot.classList.add('has-logo');};
  current.onerror=()=>{if(image!==current)return;current.remove();slot.classList.remove('has-logo');};
  slot.append(current);current.src='/api/bot-profile/avatar?ui='+Date.now();
 }
 new MutationObserver(()=>{
  const next=!app.classList.contains('hide');
  if(next&&!visible)refresh();
  if(!next&&visible){image?.remove();image=null;slot.classList.remove('has-logo');stamp='';}
  visible=next;
 }).observe(app,{attributes:true,attributeFilter:['class']});
 // Claude's existing profile screen changes the avatar src after a successful upload/removal.
 new MutationObserver(()=>{
  const profile=document.getElementById('avImg');
  const next=profile?.getAttribute('src')||'';
  if(next!==stamp){stamp=next;refresh();}
 }).observe(document.getElementById('main'),{subtree:true,childList:true,attributes:true,attributeFilter:['src']});
 window.addEventListener('focus',()=>{if(!app.classList.contains('hide'))refresh();});
 function title(){const logged=!app.classList.contains('hide');const brand=document.getElementById('wsN').textContent;const next=logged?document.getElementById('breadcrumb').textContent+' · '+(brand==='-'?'Telegram Bot':brand):'Telegram Bot 后台登入';if(document.title!==next)document.title=next;}
 new MutationObserver(title).observe(document.querySelector('title'),{childList:true});
 new MutationObserver(title).observe(app,{attributes:true,attributeFilter:['class']});
 new MutationObserver(title).observe(document.getElementById('wsN'),{childList:true});
 visible=!app.classList.contains('hide');if(visible)refresh();title();
})();

/* V6 data dialog: table overflow and keyboard/touch chart values. */
(()=>{
 const root=document.getElementById('modalRoot');
 function enhanceDialog(){
  root.querySelectorAll('table').forEach(table=>{
   if(table.parentElement.classList.contains('table-scroll'))return;
   const wrap=document.createElement('div');wrap.className='table-scroll';wrap.tabIndex=0;
   wrap.setAttribute('role','region');wrap.setAttribute('aria-label','按钮点击明细，可横向滚动');
   table.before(wrap);wrap.append(table);
  });
  root.querySelectorAll('.x-bars').forEach(chart=>{
   if(chart.dataset.uiReady)return;chart.dataset.uiReady='1';
   chart.setAttribute('role','group');chart.setAttribute('aria-label','发出后24小时点击分布');
   const value=document.createElement('div');value.className='ui-bar-value';value.setAttribute('aria-live','polite');
   value.textContent='选择柱形查看点击次数';chart.nextElementSibling?.after(value);
   chart.querySelectorAll('i').forEach(bar=>{
    bar.tabIndex=0;bar.setAttribute('role','button');bar.setAttribute('aria-label',bar.title);
    const show=()=>{value.textContent=bar.title;};
    bar.addEventListener('mouseenter',show);bar.addEventListener('focus',show);bar.addEventListener('click',show);
    bar.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();show();}});
   });
  });
 }
 new MutationObserver(enhanceDialog).observe(root,{childList:true,subtree:true});enhanceDialog();
})();
