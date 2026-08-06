' Arrête uniquement le serveur Agent OHADA (et pas d'autres process node.exe éventuels sur la
' machine) en ciblant par ligne de commande via WMI, plutôt qu'un "taskkill node.exe" générique.
Set fso = CreateObject("Scripting.FileSystemObject")
baseDir = fso.GetParentFolderName(WScript.ScriptFullName)
serverScript = Replace(baseDir & "\server\index.js", "\", "\\")

Set wmi = GetObject("winmgmts:\\.\root\cimv2")
Set procs = wmi.ExecQuery("SELECT ProcessId, CommandLine FROM Win32_Process WHERE Name = 'node.exe'")

found = False
For Each p In procs
  If InStr(p.CommandLine, serverScript) > 0 Then
    found = True
    Set target = wmi.Get("Win32_Process.Handle='" & p.ProcessId & "'")
    target.Terminate()
  End If
Next

If found Then
  MsgBox "Agent OHADA a été arrêté.", vbInformation, "Agent OHADA"
Else
  MsgBox "Agent OHADA n'était pas en cours d'exécution.", vbInformation, "Agent OHADA"
End If
