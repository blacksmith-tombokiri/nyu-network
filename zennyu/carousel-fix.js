document.addEventListener('DOMContentLoaded',()=>{
  const carousel=document.querySelector('#featured-carousel');
  if(!carousel)return;
  let startX=0,startY=0,startScroll=0,moved=false;
  const getCards=()=>[...carousel.querySelectorAll('.featured-card')];
  const cardStep=()=>{const cards=getCards();if(cards.length<2)return carousel.clientWidth;return cards[1].offsetLeft-cards[0].offsetLeft};
  const nearestIndex=()=>{const cards=getCards();if(!cards.length)return 0;const center=carousel.scrollLeft+carousel.clientWidth/2;let best=0,dist=Infinity;cards.forEach((c,i)=>{const d=Math.abs((c.offsetLeft+c.offsetWidth/2)-center);if(d<dist){dist=d;best=i}});return best};
  const goTo=(index)=>{const cards=getCards();if(!cards.length)return;const i=Math.max(0,Math.min(cards.length-1,index));const target=cards[i].offsetLeft-(carousel.clientWidth-cards[i].offsetWidth)/2;carousel.scrollTo({left:target,behavior:'smooth'})};
  carousel.addEventListener('touchstart',e=>{const t=e.touches[0];startX=t.clientX;startY=t.clientY;startScroll=carousel.scrollLeft;moved=false},{passive:true});
  carousel.addEventListener('touchmove',e=>{const t=e.touches[0];if(Math.abs(t.clientX-startX)>8)moved=true},{passive:true});
  carousel.addEventListener('touchend',e=>{const t=e.changedTouches[0];const dx=t.clientX-startX,dy=t.clientY-startY;if(Math.abs(dx)<28||Math.abs(dx)<Math.abs(dy))return;const current=nearestIndex();goTo(current+(dx<0?1:-1))},{passive:true});
  carousel.addEventListener('click',e=>{if(moved){e.preventDefault();e.stopPropagation();moved=false}},true);
  const dots=document.querySelector('#featured-dots');
  dots?.addEventListener('click',e=>{const btn=e.target.closest('button');if(!btn)return;const buttons=[...dots.querySelectorAll('button')];goTo(buttons.indexOf(btn))});
  window.addEventListener('resize',()=>{const i=nearestIndex();requestAnimationFrame(()=>goTo(i))});
});
