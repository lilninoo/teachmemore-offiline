Write-Host "🔍 Recherche de tous les fichiers 'courses.db' sur le disque C:\..."

# Recherche récursive de tous les fichiers courses.db
$coursesDbFiles = Get-ChildItem -Path "C:\" -Recurse -Filter "courses.db" -Force -ErrorAction SilentlyContinue

if ($coursesDbFiles -and $coursesDbFiles.Count -gt 0) {
    foreach ($file in $coursesDbFiles) {
        Write-Host "`n📂 Fichier trouvé : $($file.FullName)"
        try {
            Remove-Item -Path $file.FullName -Force
            Write-Host "🗑️ Supprimé : $($file.FullName)"
        } catch {
            Write-Warning "❌ Impossible de supprimer : $($file.FullName)`nErreur : $_"
        }
    }
    Write-Host "`n✅ Traitement terminé : tous les fichiers 'courses.db' trouvés ont été traités."
} else {
    Write-Host "`n⚠️ Aucun fichier 'courses.db' trouvé sur le disque C:\"
}
