; Ganchos do instalador NSIS do Mirante: liga e desliga a prévia do Explorer (miniaturas e painel de
; visualização, em mirante_preview.dll). O registro fica com o próprio mirante.exe: o NSIS é de 32 bits e
; não carregaria uma DLL de 64.

!macro NSIS_HOOK_PREINSTALL
  ; numa atualização, o Explorer pode estar com a DLL aberta: uma DLL carregada pode ser renomeada, não
  ; sobrescrita. A antiga sai na próxima reinicialização.
  IfFileExists "$INSTDIR\mirante_preview.dll" 0 +3
    Rename "$INSTDIR\mirante_preview.dll" "$INSTDIR\mirante_preview.dll.old"
    Delete /REBOOTOK "$INSTDIR\mirante_preview.dll.old"
!macroend

!macro NSIS_HOOK_POSTINSTALL
  nsExec::Exec '"$INSTDIR\${MAINBINARYNAME}.exe" --register-preview'
  Pop $0
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  nsExec::Exec '"$INSTDIR\${MAINBINARYNAME}.exe" --unregister-preview'
  Pop $0
  IfFileExists "$INSTDIR\mirante_preview.dll" 0 +3
    Rename "$INSTDIR\mirante_preview.dll" "$INSTDIR\mirante_preview.dll.old"
    Delete /REBOOTOK "$INSTDIR\mirante_preview.dll.old"
!macroend
