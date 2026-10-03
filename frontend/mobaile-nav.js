document.querySelectorAll(".bottom-nav button").forEach(btn=>{
  btn.addEventListener("click",()=>{
    document.querySelectorAll(".bottom-nav button").forEach(b=>b.classList.remove("active"));
    btn.classList.add("active");
  });
});
