---
title: "Guía para hacer copias de seguridad de proyectos de Unity en un disco duro externo con un Git Bare Repository"
date: 2026-08-22 10:00:00 +0700
categories: [Game Development, Unity]
tags: [git, backup, unity, bare-repository, usb]
description: "Guía paso a paso para configurar un Git Bare Repository en un disco duro externo (USB) con Git LFS, realizar copias de seguridad seguras de un proyecto de Unity y resolver los errores más habituales."
lang: es
translation_id: unity-git-bare-repository-usb-backup
---

Este documento recopila todo el flujo de trabajo, los comandos exactos y los errores más frecuentes durante la configuración de un **Bare Git Repository** en un disco duro portátil (USB) para utilizarlo como destino seguro de copia de seguridad (backup) de un proyecto de Unity.

## 1. Introducción al Bare Repository

- Un **Bare Repository** es un repositorio de Git sin directorio de trabajo (working directory), es decir, no contiene código directamente accesible para ver o editar. Únicamente almacena el contenido de la carpeta oculta `.git`.
- Su propósito principal es **recibir el código que se envía mediante push** desde otros ordenadores, funcionando de forma similar a un servidor local de GitHub o GitLab en tu propio disco duro.

## 2. Procedimiento de configuración paso a paso

### Paso 1: Activar Git LFS para el proyecto de Unity (Local)

Los proyectos de Unity contienen muchos archivos binarios de gran tamaño (imágenes, audio, modelos 3D). Para que Git los gestione de manera óptima, es obligatorio contar con `Git LFS`.

1. Abre la terminal (Git Bash) en la carpeta de tu proyecto de Unity (p. ej., `D:\Unity-Projects\GLW`).
2. Descarga la plantilla `.gitattributes` estándar de GameCI para Unity.
3. Ejecuta el comando para inicializar LFS:

   ```bash
   git lfs install
   ```

4. Incorpora el archivo de configuración al historial de Git:

   ```bash
   git add .gitattributes
   git commit -m "Añadir configuración de gitattributes para Unity y Git LFS"
   ```

### Paso 2: Crear el Bare Repo en el disco duro portátil

1. Conecta el disco duro externo al ordenador (supongamos que el sistema lo asigna como unidad `E:`).
2. Abre **Git Bash** y desplázate hasta la carpeta donde quieras guardar la copia de seguridad (p. ej., `E:\Git`):

   ```bash
   cd /e/Git
   ```

3. Crea la carpeta que contendrá el repositorio (por convención, terminada en `.git`).

   > [!IMPORTANT]
   > **Nota sumamente importante:** En Git Bash debes usar la barra inclinada hacia delante `/`, nunca la barra invertida `\` propia de Windows.

   ```bash
   mkdir -p "GLW.git"
   ```

4. Entra en la carpeta recién creada e inicializa el Bare Repo:

   ```bash
   cd "GLW.git"
   git init --bare
   ```

### Paso 3: Vincular el proyecto de Unity con el disco duro (Añadir Remote)

1. Vuelve a la terminal (Git Bash) situada en la carpeta del proyecto de Unity (`D:\Unity-Projects\GLW`).
2. Añade el repositorio remoto (llámalo `glw` o `usb`):

   ```bash
   git remote add glw "E:/Git/GLW.git"
   ```

3. Comprueba que el remoto se ha configurado correctamente:

   ```bash
   git remote -v
   ```
   *(Si el resultado muestra dos líneas, fetch y push, apuntando a `E:/Git/GLW.git`, la vinculación habrá tenido éxito).*

### Paso 4: Resolver el error de seguridad de permisos (Dubious Ownership)

Al subir código a un disco duro formateado en exFAT o FAT32, Git mostrará el error `"dubious ownership"` porque este tipo de sistemas de archivos no almacena los permisos de propietario de usuario como NTFS, lo que hace que Git considere que el repositorio no tiene dueño y lo bloquee por motivos de seguridad.

**Solución:** Añade explícitamente esa carpeta a la lista de directorios seguros de Git:

```bash
git config --global --add safe.directory "E:/Git/GLW.git"
```

### Paso 5: Hacer push del código al disco duro

Cuando todo esté configurado, ejecuta los siguientes comandos para enviar todas las ramas (branches) y etiquetas (tags) y así realizar una copia de seguridad completa al 100 % del proyecto:

```bash
git push glw --all
git push glw --tags
```
*(Espera a que finalice el proceso y tu proyecto quedará respaldado de forma segura en el disco duro).*

---

## 3. Errores habituales (Troubleshooting)

### 3.1. Error al crear un nombre de carpeta incorrecto (Nombres pegados)

- **Síntoma:** Al ejecutar `mkdir -p E:\Git\GLW.git` en Git Bash, la carpeta resultante se crea con el nombre `GitGLW.git`.
- **Causa:** Git Bash interpreta la barra `\` como un carácter de escape. Ignora el símbolo `\` y une `Git` con `GLW` formando `GitGLW`.
- **Solución:** Utiliza siempre barras inclinadas `/` o comillas al escribir rutas en Git Bash (p. ej., `mkdir -p "E:/Git/GLW.git"`).

### 3.2. Error `"fatal: 'E:BackupGitGLW.git' does not appear to be a git repository"`

- **Síntoma:** Al hacer push, Git informa de que no encuentra el repositorio remoto.
- **Causa:** Al ejecutar `git remote add`, utilizaste barras invertidas (`\`), lo que corrompió la ruta guardada.
- **Solución:**
  1. Elimina la configuración errónea del remoto:

     ```bash
     git remote remove glw
     ```

  2. Vuelve a añadir el remoto con la ruta correcta:

     ```bash
     git remote add glw "E:/Git/GLW.git"
     ```
     *(También puedes usar `git remote set-url glw "E:/Git/GLW.git"` para sobrescribirlo).*

### 3.3. Olvidar inicializar el Bare Repo

- **Síntoma:** Aunque la ruta del remoto sea correcta, al hacer push sigue apareciendo el error `Could not read from remote repository`.
- **Causa:** No se ha ejecutado el comando `git init --bare` dentro de la carpeta en el disco duro.
- **Solución:** Abre el Explorador de archivos, ve a la carpeta del disco duro, haz clic con el botón derecho, selecciona **Open Git Bash here** y ejecuta `git init --bare`.
