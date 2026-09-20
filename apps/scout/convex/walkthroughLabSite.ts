export const labHtml = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Notebook</title>
<style>body{font:18px system-ui;max-width:720px;margin:48px auto;padding:16px;color:#17242e}label{display:block;margin:20px 0}input,textarea,button{font:inherit;padding:10px}input,textarea{display:block;width:90%;margin-top:6px}textarea{height:140px}button{margin:8px 12px 8px 0}#status{padding:16px;background:#edf2f6}h1{margin-bottom:8px}</style></head>
<body><h1>Notebook</h1><p>Keep a note and export a copy.</p>
<form id="note"><label>Title<input id="title" required></label><label>Note<textarea id="body" required></textarea></label><button type="submit">Save note</button></form>
<button id="export" type="button">Export CSV</button><p id="status" role="status">No saved note</p>
<script>
const title = document.getElementById('title');
const body = document.getElementById('body');
const status = document.getElementById('status');
const saved = JSON.parse(localStorage.getItem('scout-walkthrough-note') || 'null');
if(saved){title.value=saved.title;body.value=saved.body;status.textContent='Saved note loaded';}
document.getElementById('note').addEventListener('submit',event=>{event.preventDefault();localStorage.setItem('scout-walkthrough-note',JSON.stringify({title:title.value,body:body.value}));status.textContent='Note saved';});
document.getElementById('export').addEventListener('click',()=>{status.textContent='Export failed: server error (500). No file was created.';});
</script></body></html>`;
