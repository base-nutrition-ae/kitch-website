/* KITCH Main Office mobile drawer behavior — no changes to authentication or cloud data. */
(function(){
 const app=document.getElementById('officeApp');
 const trigger=document.getElementById('officeMobileMenu');
 const backdrop=document.getElementById('officeMobileBackdrop');
 if(!app||!trigger||!backdrop)return;
 const menu=app.querySelector('.officeSidebar');
 const close=()=>{
  app.classList.remove('officeMobileOpen');
  trigger.setAttribute('aria-expanded','false');
  trigger.setAttribute('aria-label','Open Main Office menu');
  trigger.textContent='☰';
  document.body.style.overflow='';
 };
 const open=()=>{
  app.classList.add('officeMobileOpen');
  trigger.setAttribute('aria-expanded','true');
  trigger.setAttribute('aria-label','Close Main Office menu');
  trigger.textContent='×';
  document.body.style.overflow='hidden';
 };
 trigger.addEventListener('click',()=>app.classList.contains('officeMobileOpen')?close():open());
 backdrop.addEventListener('click',close);
 menu?.querySelectorAll('.topnav button').forEach(b=>b.addEventListener('click',close));
 menu?.querySelector('#officeSidebarLogout')?.addEventListener('click',close);
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&app.classList.contains('officeMobileOpen')){close();trigger.focus();}});
 window.addEventListener('resize',()=>{if(window.innerWidth>850&&app.classList.contains('officeMobileOpen'))close();});
})();
