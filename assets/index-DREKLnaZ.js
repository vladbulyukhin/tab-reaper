var f=Object.defineProperty;var u=(i,t,e)=>t in i?f(i,t,{enumerable:!0,configurable:!0,writable:!0,value:e}):i[t]=e;var r=(i,t,e)=>u(i,typeof t!="symbol"?t+"":t,e);(function(){const t=document.createElement("link").relList;if(t&&t.supports&&t.supports("modulepreload"))return;for(const o of document.querySelectorAll('link[rel="modulepreload"]'))a(o);new MutationObserver(o=>{for(const n of o)if(n.type==="childList")for(const s of n.addedNodes)s.tagName==="LINK"&&s.rel==="modulepreload"&&a(s)}).observe(document,{childList:!0,subtree:!0});function e(o){const n={};return o.integrity&&(n.integrity=o.integrity),o.referrerPolicy&&(n.referrerPolicy=o.referrerPolicy),o.crossOrigin==="use-credentials"?n.credentials="include":o.crossOrigin==="anonymous"?n.credentials="omit":n.credentials="same-origin",n}function a(o){if(o.ep)return;o.ep=!0;const n=e(o);fetch(o.href,n)}})();const l=[{domain:"stackoverflow.com",title:"That Stack Overflow answer you'll never read",faviconColor:"#FF4500"},{domain:"amazon.com",title:"Shopping cart from 3 months ago",faviconColor:"#2BAB4E"},{domain:"docs.example.com",title:"15 tabs of documentation",faviconColor:"#1B73E8"},{domain:"youtube.com",title:"Tutorial video you'll watch later",faviconColor:"#FF0000"},{domain:"medium.com",title:"Interesting article from last week",faviconColor:"#2E69FF"},{domain:"github.com",title:"Open source project you forgot about",faviconColor:"#333333"},{domain:"reddit.com",title:"Subreddit rabbit hole",faviconColor:"#FF4500"},{domain:"twitter.com",title:"Tweet you never liked",faviconColor:"#1DA1F2"},{domain:"facebook.com",title:"Friend's birthday post from last year",faviconColor:"#4267B2"},{domain:"instagram.com",title:"Photo from last summer's vacation",faviconColor:"#C13584"}];class c{constructor(t){r(this,"container");r(this,"tabs",[]);r(this,"animationInterval");r(this,"isRunning",!1);r(this,"MIN_TABS",3);r(this,"MAX_TABS",8);const e=document.getElementById(t);if(!e)throw new Error(`Container ${t} not found`);this.container=e}createTabElement(){const t=l[Math.floor(Math.random()*l.length)],e=document.createElement("div");e.className="tab-card",e.style.left=`${Math.random()*(this.container.clientWidth-280)}px`,e.style.transform=`translateY(-50px) rotate(${(Math.random()-.5)*30}deg)`;const a=document.createElement("div");a.style.cssText=`
      position: absolute;
      left: 20px;
      top: 16px;
      width: 16px;
      height: 16px;
      border-radius: 50%;
      background-color: ${t.faviconColor};
    `;const o=document.createElement("div");o.style.cssText=`
      position: absolute;
      left: 44px;
      top: 10px;
      font-size: 10px;
      color: #666;
    `,o.textContent=t.domain;const n=document.createElement("div");return n.style.cssText=`
      position: absolute;
      left: 44px;
      top: 24px;
      font-size: 11px;
      color: #333;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      width: 220px;
    `,n.textContent=t.title,e.appendChild(a),e.appendChild(o),e.appendChild(n),e}addNewTab(){if(this.tabs.length>=this.MAX_TABS)return;const t=this.createTabElement();this.container.appendChild(t),this.tabs.push(t),requestAnimationFrame(()=>{t.style.opacity="1",t.style.transform=`translateY(${this.container.clientHeight+100}px) rotate(${(Math.random()-.5)*30}deg)`,t.addEventListener("transitionend",e=>{e.propertyName==="transform"&&(t.remove(),this.tabs=this.tabs.filter(a=>a!==t))})})}animate(){if(this.isRunning){if(this.tabs.length<this.MIN_TABS){this.addNewTab();return}Math.random()<.3&&this.addNewTab()}}start(){if(!this.isRunning){this.isRunning=!0;for(let t=0;t<this.MIN_TABS;t++)setTimeout(()=>this.addNewTab(),t*500);this.animationInterval=setInterval(()=>this.animate(),1e3)}}stop(){this.isRunning&&(this.isRunning=!1,this.animationInterval&&clearInterval(this.animationInterval))}cleanup(){this.stop();for(const t of this.tabs)t.remove();this.tabs=[]}}const d=new c("hero-tab-container"),m=new c("tab-container");d.start();m.start();window.addEventListener("pagehide",()=>{d.cleanup(),m.cleanup()});
