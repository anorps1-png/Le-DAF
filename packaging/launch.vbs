' ====================================================================
' Lanceur Bureau Autonome pour Agent OHADA (Le-DAF)
' Démarre le serveur Node.js en arrière-plan sans console,
' puis ouvre l'application dans une FENÊTRE DÉDIÉE SANS NAVIGATEUR
' (Mode App Standalone : pas d'onglets, pas de barre d'adresse URL).
' ====================================================================
Option Explicit
Dim fso, shell, baseDir, nodeExe, serverScript, procs, wmi, isRunning, p
Dim edgePath, chromePath, appProfileDir, browserCmd, localAppData

Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

baseDir = fso.GetParentFolderName(WScript.ScriptFullName)
nodeExe = baseDir & "\node.exe"
serverScript = baseDir & "\server\index.js"
localAppData = shell.ExpandEnvironmentStrings("%LOCALAPPDATA%")
appProfileDir = localAppData & "\AgentOHADA\app-profile"

' 1. Vérifie si le serveur Node.js est déjà actif pour ce script
isRunning = False
On Error Resume Next
Set wmi = GetObject("winmgmts:\\.\root\cimv2")
Set procs = wmi.ExecQuery("SELECT ProcessId, CommandLine FROM Win32_Process WHERE Name = 'node.exe'")
For Each p In procs
  If InStr(p.CommandLine, Replace(serverScript, "\", "\\")) > 0 Or InStr(p.CommandLine, "server\index.js") > 0 Then
    isRunning = True
    Exit For
  End If
Next
On Error GoTo 0

' 2. Démarre le serveur Node si nécessaire (fenêtre complètement masquée = 0)
If Not isRunning Then
  shell.Run """" & nodeExe & """ """ & serverScript & """", 0, False
  WScript.Sleep 1800
End If

' 3. Recherche du moteur de fenêtre d'application (MS Edge ou Google Chrome en mode --app)
edgePath = ""
If fso.FileExists(shell.ExpandEnvironmentStrings("%ProgramFiles(x86)%") & "\Microsoft\Edge\Application\msedge.exe") Then
  edgePath = shell.ExpandEnvironmentStrings("%ProgramFiles(x86)%") & "\Microsoft\Edge\Application\msedge.exe"
ElseIf fso.FileExists(shell.ExpandEnvironmentStrings("%ProgramFiles%") & "\Microsoft\Edge\Application\msedge.exe") Then
  edgePath = shell.ExpandEnvironmentStrings("%ProgramFiles%") & "\Microsoft\Edge\Application\msedge.exe"
ElseIf fso.FileExists(localAppData & "\Microsoft\Edge\Application\msedge.exe") Then
  edgePath = localAppData & "\Microsoft\Edge\Application\msedge.exe"
End If

chromePath = ""
If fso.FileExists(shell.ExpandEnvironmentStrings("%ProgramFiles%") & "\Google\Chrome\Application\chrome.exe") Then
  chromePath = shell.ExpandEnvironmentStrings("%ProgramFiles%") & "\Google\Chrome\Application\chrome.exe"
ElseIf fso.FileExists(shell.ExpandEnvironmentStrings("%ProgramFiles(x86)%") & "\Google\Chrome\Application\chrome.exe") Then
  chromePath = shell.ExpandEnvironmentStrings("%ProgramFiles(x86)%") & "\Google\Chrome\Application\chrome.exe"
ElseIf fso.FileExists(localAppData & "\Google\Chrome\Application\chrome.exe") Then
  chromePath = localAppData & "\Google\Chrome\Application\chrome.exe"
End If

' 4. Lancement dans une fenêtre autonome dédiée (sans onglets, sans barre d'adresse)
If edgePath <> "" Then
  browserCmd = """" & edgePath & """ --app=http://localhost:3000 --window-size=1440,900 --user-data-dir=""" & appProfileDir & """ --app-id=AgentOHADA"
  shell.Run browserCmd, 1, False
ElseIf chromePath <> "" Then
  browserCmd = """" & chromePath & """ --app=http://localhost:3000 --window-size=1440,900 --user-data-dir=""" & appProfileDir & """"
  shell.Run browserCmd, 1, False
Else
  ' Repli si aucun navigateur Chromium n'est trouvé
  shell.Run "http://localhost:3000", 1, False
End If
