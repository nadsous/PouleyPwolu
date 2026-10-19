; PouleyPwolu se déclare à Windows comme navigateur web, pour apparaître dans
; Paramètres > Applications > Applications par défaut. Windows ne laisse
; aucune application se mettre par défaut toute seule : c'est l'utilisateur qui
; choisit, PouleyPwolu ouvre juste la bonne page des Paramètres.
; Installation par utilisateur (perMachine: false) : tout va dans HKCU.

!define PP_CLIENT "Software\Clients\StartMenuInternet\PouleyPwolu"
!define PP_EXE "$INSTDIR\${APP_EXECUTABLE_FILENAME}"

!macro ppProgId ID LABEL
  WriteRegStr HKCU "Software\Classes\${ID}" "" "${LABEL}"
  WriteRegStr HKCU "Software\Classes\${ID}" "FriendlyTypeName" "${LABEL}"
  WriteRegStr HKCU "Software\Classes\${ID}\DefaultIcon" "" "${PP_EXE},0"
  WriteRegStr HKCU "Software\Classes\${ID}\shell\open\command" "" '"${PP_EXE}" "%1"'
  WriteRegStr HKCU "Software\Classes\${ID}\Application" "ApplicationName" "PouleyPwolu"
  WriteRegStr HKCU "Software\Classes\${ID}\Application" "ApplicationIcon" "${PP_EXE},0"
  WriteRegStr HKCU "Software\Classes\${ID}\Application" "ApplicationCompany" "Nadir Tounsi (Nads)"
  WriteRegStr HKCU "Software\Classes\${ID}\Application" "AppUserModelId" "${APP_ID}"
!macroend

!macro customInstall
  !insertmacro ppProgId "PouleyPwoluHTML" "Document HTML PouleyPwolu"
  !insertmacro ppProgId "PouleyPwoluURL" "Lien web PouleyPwolu"
  WriteRegStr HKCU "Software\Classes\PouleyPwoluURL" "URL Protocol" ""

  WriteRegStr HKCU "${PP_CLIENT}" "" "PouleyPwolu"
  WriteRegStr HKCU "${PP_CLIENT}\DefaultIcon" "" "${PP_EXE},0"
  WriteRegStr HKCU "${PP_CLIENT}\shell\open\command" "" '"${PP_EXE}"'
  WriteRegStr HKCU "${PP_CLIENT}\Capabilities" "ApplicationName" "PouleyPwolu"
  WriteRegStr HKCU "${PP_CLIENT}\Capabilities" "ApplicationIcon" "${PP_EXE},0"
  WriteRegStr HKCU "${PP_CLIENT}\Capabilities" "ApplicationDescription" "Navigateur léger et privé, basé sur Chromium. Zéro télémétrie."
  WriteRegStr HKCU "${PP_CLIENT}\Capabilities\StartMenu" "StartMenuInternet" "PouleyPwolu"
  WriteRegStr HKCU "${PP_CLIENT}\Capabilities\URLAssociations" "http" "PouleyPwoluURL"
  WriteRegStr HKCU "${PP_CLIENT}\Capabilities\URLAssociations" "https" "PouleyPwoluURL"
  WriteRegStr HKCU "${PP_CLIENT}\Capabilities\FileAssociations" ".htm" "PouleyPwoluHTML"
  WriteRegStr HKCU "${PP_CLIENT}\Capabilities\FileAssociations" ".html" "PouleyPwoluHTML"
  WriteRegStr HKCU "${PP_CLIENT}\Capabilities\FileAssociations" ".shtml" "PouleyPwoluHTML"
  WriteRegStr HKCU "${PP_CLIENT}\Capabilities\FileAssociations" ".xht" "PouleyPwoluHTML"
  WriteRegStr HKCU "${PP_CLIENT}\Capabilities\FileAssociations" ".xhtml" "PouleyPwoluHTML"
  WriteRegStr HKCU "Software\RegisteredApplications" "PouleyPwolu" "${PP_CLIENT}\Capabilities"

  ; Les fichiers .html proposent PouleyPwolu dans « Ouvrir avec ».
  WriteRegStr HKCU "Software\Classes\.htm\OpenWithProgids" "PouleyPwoluHTML" ""
  WriteRegStr HKCU "Software\Classes\.html\OpenWithProgids" "PouleyPwoluHTML" ""

  ; Prévenir l'Explorateur que les associations ont changé.
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend

!macro customUnInstall
  ; Une mise à jour désinstalle l'ancienne version juste avant d'installer la
  ; nouvelle : on garde alors l'inscription (et le choix de l'utilisateur).
  ${ifNot} ${isUpdated}
    DeleteRegValue HKCU "Software\RegisteredApplications" "PouleyPwolu"
    DeleteRegKey HKCU "${PP_CLIENT}"
    DeleteRegKey HKCU "Software\Classes\PouleyPwoluHTML"
    DeleteRegKey HKCU "Software\Classes\PouleyPwoluURL"
    DeleteRegValue HKCU "Software\Classes\.htm\OpenWithProgids" "PouleyPwoluHTML"
    DeleteRegValue HKCU "Software\Classes\.html\OpenWithProgids" "PouleyPwoluHTML"
    System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
  ${endIf}
!macroend
