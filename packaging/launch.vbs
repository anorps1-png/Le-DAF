' Lance le serveur Agent OHADA en arrière-plan (sans fenêtre console) puis ouvre le navigateur.
' Ce fichier est copié à la racine du dossier d'installation par l'installateur Inno Setup ;
' node.exe et server/index.js sont donc toujours dans le même dossier que ce script.
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

baseDir = fso.GetParentFolderName(WScript.ScriptFullName)
nodeExe = baseDir & "\node.exe"
serverScript = baseDir & "\server\index.js"

' Démarre le serveur Node caché (0 = fenêtre masquée), sans attendre sa fin (False).
shell.Run """" & nodeExe & """ """ & serverScript & """", 0, False

' Laisse le temps au serveur Express de démarrer avant d'ouvrir le navigateur.
WScript.Sleep 1500
shell.Run "http://localhost:3000", 1, False
