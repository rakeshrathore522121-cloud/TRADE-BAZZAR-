const A="/api", $=s=>document.querySelector(s);
async function api(u,o={}){const r=await fetch(A+u,{credentials:"include",headers:{"Content-Type":"application/json",...(o.headers||{})},...o});const d=await r.json().catch(()=>({}));if(!r.ok)throw Error(d.message||"Request failed");return d}
const esc=x=>String(x??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));

async function loadStats(){const d=await api("/admin/stats");$("#stats").innerHTML=Object.entries({Users:d.stats.users,"Active":d.stats.active_users,"Pending Deposits":d.stats.pending_deposits,"Pending Withdrawals":d.stats.pending_withdrawals,"Orders":d.stats.orders,"User Balance":`₹${Number(d.stats.balance_total).toFixed(2)}`}).map(([k,v])=>`<div class="stat"><small>${k}</small><strong>${v}</strong></div>`).join("")}

async function loadUsers(){
    try {
        const d=await api("/admin/users");
        $("#usersTable").innerHTML=
            "<tr><th>User</th><th>Name</th><th>Mobile</th><th>PAN</th><th>Aadhaar</th><th>Account Balance</th><th>Forex Balance</th><th>Status</th><th>Actions</th></tr>"+
            d.users.map(u=>`<tr>
                <td>${esc(u.user_id)}</td>
                <td>${esc(u.name)}</td>
                <td>${esc(u.mobile)}</td>
                <td>${esc(u.pan)}</td>
                <td>${esc(u.aadhaar)}</td>
                <td>₹${Number(u.balance||0).toFixed(2)}</td>
                <td>$${Number(u.forex_balance||0).toFixed(2)}</td>
                <td>${u.blocked?"BLOCKED":u.active?"ACTIVE":"INACTIVE"}</td>
                <td>
                    <button class="action approve" onclick="editUser(${u.id})">EDIT</button>
                    <button class="action ${u.blocked?"approve":"reject"}" onclick="toggleUser(${u.id},${!u.blocked})">${u.blocked?"UNBLOCK":"BLOCK"}</button>
                    <button class="action approve" onclick="adjustBalance(${u.id})">BALANCE</button>
                    <button class="action approve" onclick="adjustForexBalance(${u.id})">FOREX BALANCE</button>
                </td>
            </tr>`).join("");
    } catch(e) {
        alert("Users load nahi ho sake: "+e.message);
    }
}

async function editUser(id){const d=await api("/admin/users");const u=d.users.find(x=>x.id===id);if(!u)return;const name=prompt("Name",u.name||"");if(name===null)return;const mobile=prompt("Mobile",u.mobile||"");const email=prompt("Email",u.email||"");const pan=prompt("PAN",u.pan||"");const aadhaar=prompt("Aadhaar",u.aadhaar||"");const pw=prompt("New password (blank = keep)", "");const body={name,mobile,email,pan,aadhaar};if(pw)body.reset_password=pw;await api("/admin/users/"+id,{method:"PATCH",body:JSON.stringify(body)});loadUsers()}
async function toggleUser(id,unblock){await api("/admin/users/"+id,{method:"PATCH",body:JSON.stringify({blocked:!unblock})});loadUsers();loadStats()}

async function adjustBalance(id){
    const amount=prompt("Amount (+ add / - deduct)");
    if(amount===null)return;
    const value=Number(amount);
    if(!amount.trim()||!Number.isFinite(value)||value===0){alert("Please enter a valid non-zero amount.");return}
    const note=prompt("Note","Admin adjustment");
    if(note===null)return;
    try{
        const result=await api("/admin/users/"+id+"/balance",{method:"POST",body:JSON.stringify({amount:value,note:note||"Admin adjustment"})});
        alert(result.message||"Account balance updated.");
        await loadUsers();
        await loadStats();
    }catch(e){alert(e.message)}
}

async function adjustForexBalance(id){
    try{
        const d=await api("/admin/users");
        const u=d.users.find(x=>Number(x.id)===Number(id));
        if(!u){alert("User not found.");return}
        const current=Number(u.forex_balance||0);
        const input=prompt(
            `User ID: ${u.user_id}\nCurrent Forex Balance: $${current.toFixed(2)}\n\nPositive = Add\nNegative = Deduct`,
            "100"
        );
        if(input===null)return;
        const amount=Number(input);
        if(!input.trim()||!Number.isFinite(amount)||amount===0){alert("Please enter a valid non-zero amount.");return}
        const note=prompt("Reason for Forex balance adjustment:","Admin Forex balance adjustment");
        if(note===null)return;
        const result=await api(`/admin/users/${id}/forex-balance`,{
            method:"POST",
            body:JSON.stringify({amount:amount,note:note||"Admin Forex balance adjustment"})
        });
        alert((result.message||"Forex balance updated successfully.")+`\nNew Forex Balance: $${Number(result.forex_balance).toFixed(2)}`);
        await loadUsers();
    }catch(e){alert(e.message)}
}

async function loadDeps(){const d=await api("/admin/deposits");$("#depsTable").innerHTML="<tr><th>ID</th><th>User</th><th>Amount</th><th>UTR</th><th>Status</th><th>Action</th></tr>"+d.deposits.map(x=>`<tr><td>${x.id}</td><td>${esc(x.user_id)}</td><td>₹${Number(x.amount).toFixed(2)}</td><td>${esc(x.utr)}</td><td>${x.status}</td><td>${x.status==="PENDING"?`<button class="action approve" onclick="reviewDep(${x.id},'APPROVE')">Approve</button><button class="action reject" onclick="reviewDep(${x.id},'REJECT')">Reject</button>`:"—"}</td></tr>`).join("")}
async function reviewDep(id,a){const reason=a==="REJECT"?prompt("Reason")||"":"";await api("/admin/deposits/"+id+"/review",{method:"POST",body:JSON.stringify({action:a,reason})});loadDeps();loadStats()}
async function loadWds(){const d=await api("/admin/withdrawals");$("#wdsTable").innerHTML="<tr><th>ID</th><th>User</th><th>Amount</th><th>UPI</th><th>Bank</th><th>Status</th><th>Action</th></tr>"+d.withdrawals.map(x=>`<tr><td>${x.id}</td><td>${esc(x.user_id)}</td><td>₹${Number(x.amount).toFixed(2)}</td><td>${esc(x.upi_id)}</td><td>${esc(x.bank_name)}</td><td>${x.status}</td><td>${x.status==="PENDING"?`<button class="action approve" onclick="reviewWd(${x.id},'APPROVE')">Approve</button><button class="action reject" onclick="reviewWd(${x.id},'REJECT')">Reject</button>`:"—"}</td></tr>`).join("")}
async function reviewWd(id,a){const reason=a==="REJECT"?prompt("Reason")||"":"";await api("/admin/withdrawals/"+id+"/review",{method:"POST",body:JSON.stringify({action:a,reason})});loadWds();loadStats()}
async function loadOrders(){const d=await api("/admin/orders");$("#ordersTable").innerHTML="<tr><th>ID</th><th>User</th><th>Symbol</th><th>Side</th><th>Qty</th><th>Price</th><th>P&L</th><th>Status</th></tr>"+d.orders.map(x=>`<tr><td>${x.id}</td><td>${esc(x.user_id)}</td><td>${esc(x.symbol)}</td><td>${x.side}</td><td>${x.quantity}</td><td>${x.price}</td><td>${x.pnl}</td><td>${x.status}</td></tr>`).join("")}
async function loadPositions(){const d=await api("/admin/positions");$("#positionsTable").innerHTML="<tr><th>User</th><th>Symbol</th><th>Qty</th><th>Avg</th><th>LTP</th><th>Unrealized P&L</th></tr>"+d.positions.map(x=>`<tr><td>${esc(x.user_id)}</td><td>${esc(x.symbol)}</td><td>${x.quantity}</td><td>₹${Number(x.avg_price).toFixed(2)}</td><td>₹${Number(x.ltp).toFixed(2)}</td><td>${x.unrealized_pnl}</td></tr>`).join("")}
async function loadSettings(){const d=await api("/admin/settings");$("#upiId").value=d.settings.upi_id||"";$("#qrPreview").src=d.settings.qr_image||""}
async function loadNews(){const d=await api("/news");$("#newsAdmin").innerHTML=d.news.map(n=>`<div class="news-line">${esc(n.headline)} <button class="action reject" onclick="delNews(${n.id})">Delete</button></div>`).join("")}
async function delNews(id){await api("/admin/news/"+id,{method:"DELETE"});loadNews()}
async function loadAll(){await Promise.all([loadStats(),loadUsers(),loadDeps(),loadWds(),loadOrders(),loadPositions(),loadSettings(),loadNews()])}
async function boot(){try{const d=await api("/me");if(d.user.role!=="admin")throw Error();$("#loginView").classList.add("hidden");$("#panelView").classList.remove("hidden");loadAll()}catch{}}
$("#adminLogin").onsubmit=async e=>{e.preventDefault();try{await api("/admin/login",{method:"POST",body:JSON.stringify({user_id:$("#aid").value.trim(),password:$("#apw").value})});boot()}catch(x){$("#am").textContent=x.message}}
$("#createUser").onclick=async()=>{try{await api("/admin/users",{method:"POST",body:JSON.stringify({user_id:$("#newUid").value,password:$("#newPw").value,name:$("#newName").value,mobile:$("#newMobile").value,email:$("#newEmail").value,pan:$("#newPan").value,aadhaar:$("#newAadhaar").value,dob:$("#newDob").value})});alert("User created");loadUsers();loadStats()}catch(e){alert(e.message)}}
$("#loadUsers").onclick=loadUsers;$("#loadDeps").onclick=loadDeps;$("#loadWds").onclick=loadWds;$("#loadOrders").onclick=loadOrders;$("#loadPositions").onclick=loadPositions;
$("#saveUpi").onclick=async()=>{try{await api("/admin/settings",{method:"PUT",body:JSON.stringify({upi_id:$("#upiId").value.trim()})});alert("UPI updated")}catch(e){alert(e.message)}}
$("#uploadQr").onclick=async()=>{const f=$("#qrFile").files[0];if(!f)return alert("Select QR image");const fd=new FormData();fd.append("qr",f);try{const r=await fetch("/api/admin/qr-upload",{method:"POST",credentials:"include",body:fd});const d=await r.json();if(!r.ok)throw Error(d.message);$("#qrPreview").src=d.qr_image;alert("QR updated")}catch(e){alert(e.message)}}
$("#removeQr").onclick=async()=>{await api("/admin/qr-remove",{method:"POST"});$("#qrPreview").removeAttribute("src");alert("QR removed")}
$("#addNews").onclick=async()=>{await api("/admin/news",{method:"POST",body:JSON.stringify({headline:$("#headline").value})});$("#headline").value="";loadNews()}
$("#alogout").onclick=()=>api("/logout",{method:"POST"}).then(()=>location.reload());boot();
