(function(){
  var tablist = document.querySelector('.tabs');
  if(!tablist) return;
  tablist.addEventListener('keydown', function(event){
    if(event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    var tabs = Array.prototype.slice.call(tablist.querySelectorAll('[role="tab"]'));
    var current = tabs.indexOf(document.activeElement);
    if(current < 0 || !tabs.length) return;
    event.preventDefault();
    var delta = event.key === 'ArrowRight' ? 1 : -1;
    tabs[(current + delta + tabs.length) % tabs.length].focus();
  });

  // 탭 높이를 CSS 변수로 공유해 아래 sticky 바가 탭을 가리지 않게 함
  var syncHeight = function(){ document.documentElement.style.setProperty('--tabs-h', tablist.offsetHeight + 'px'); };
  syncHeight();
  if(window.ResizeObserver) new ResizeObserver(syncHeight).observe(tablist);
  window.addEventListener('resize', syncHeight);

  // 마우스 드래그로 탭 가로 스크롤 (터치는 기본 스크롤 사용). 예약 모달 탭도 포함
  var drag = null;
  document.addEventListener('pointerdown', function(event){
    if(event.pointerType !== 'mouse' || event.button !== 0) return;
    var scroller = event.target.closest('.tabs, .modal-tabs');
    if(scroller) drag = {el:scroller, x:event.clientX, left:scroller.scrollLeft, moved:false};
  });
  window.addEventListener('pointermove', function(event){
    if(!drag) return;
    var dx = event.clientX - drag.x;
    if(!drag.moved && Math.abs(dx) < 5) return;
    drag.moved = true;
    drag.el.classList.add('dragging');
    drag.el.scrollLeft = drag.left - dx;
  });
  window.addEventListener('pointerup', function(){
    if(!drag) return;
    var el = drag.el, moved = drag.moved;
    drag = null;
    if(!moved) return;
    el.classList.remove('dragging');
    var block = function(e){ e.stopPropagation(); e.preventDefault(); };
    el.addEventListener('click', block, true);
    setTimeout(function(){ el.removeEventListener('click', block, true); }, 0);
  });
})();
