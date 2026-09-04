# PowerShell: renomme App.js -> app.js (systèmes sensibles à la casse)
Set-Location -Path "\\\ccserveur\\UsersData\\daumat\\Downloads\\samex-main"
if (Test-Path -LiteralPath .\\App.js) {
  Rename-Item -LiteralPath .\\App.js -NewName app.js -Force
  git add App.js app.js index.html
  git commit -m "Fix: normalize script filename to app.js"
  git push origin main
  Write-Host "Renommage effectué et push réalisé."
} else {
  Write-Host "Fichier App.js introuvable dans le répertoire courant."
}
