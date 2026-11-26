---
title: "Guia para efetuar cópias de segurança de projetos Unity num disco externo com Git Bare Repository"
date: 2026-08-22 10:00:00 +0700
categories: [Game Development, Unity]
tags: [git, backup, unity, bare-repository, usb]
description: "Guia passo a passo para configurar um Git Bare Repository num disco rígido externo (USB) com Git LFS, salvaguardar com segurança projetos Unity e resolver os erros mais frequentes."
lang: pt-PT
translation_id: unity-git-bare-repository-usb-backup
---

Este documento reúne todo o fluxo de trabalho, os comandos exatos e os erros mais frequentes durante a configuração de um **Bare Git Repository** num disco rígido externo (USB) para servir de destino seguro de cópia de segurança (backup) para um projeto Unity.

## 1. Introdução ao Bare Repository

- Um **Bare Repository** é um repositório Git sem diretório de trabalho (working directory), ou seja, não contém ficheiros de código diretamente acessíveis para visualizar ou editar. Guarda apenas o conteúdo da pasta oculta `.git`.
- A sua principal finalidade é **receber código enviado por push** a partir de outros computadores, funcionando de modo semelhante a um servidor GitHub ou GitLab local no seu disco rígido.

## 2. Procedimento de configuração correto (Passo a passo)

### Passo 1: Ativar o Git LFS para o projeto Unity (Local)

Os projetos Unity contêm bastantes ficheiros binários de grande dimensão (imagens, áudio, modelos 3D). Para que o Git os trate de forma otimizada, é obrigatório utilizar `Git LFS`.

1. Abra o Terminal (Git Bash) na pasta do seu projeto Unity (por ex., `D:\Unity-Projects\GLW`).
2. Descarregue o modelo `.gitattributes` padrão do GameCI para Unity.
3. Execute o comando para inicializar o LFS:

   ```bash
   git lfs install
   ```

4. Adicione o ficheiro de configuração ao histórico do Git:

   ```bash
   git add .gitattributes
   git commit -m "Adicionar configuração gitattributes para Unity e Git LFS"
   ```

### Passo 2: Criar o Bare Repo no disco rígido externo

1. Ligue o disco externo ao computador (supondo que o sistema lhe atribui a unidade `E:`).
2. Abra o **Git Bash** e navegue até à pasta onde pretende guardar a cópia de segurança (por ex., `E:\Git`):

   ```bash
   cd /e/Git
   ```

3. Crie a pasta que irá conter o repositório (seguindo a convenção da extensão `.git`).

   > [!IMPORTANT]
   > **Nota extremamente importante:** No Git Bash deve utilizar a barra oblíqua `/`, e não a barra invertida `\` do Windows.

   ```bash
   mkdir -p "GLW.git"
   ```

4. Entre na pasta acabada de criar e inicialize o Bare Repo:

   ```bash
   cd "GLW.git"
   git init --bare
   ```

### Passo 3: Associar o projeto Unity ao disco externo (Adicionar Remote)

1. Regresse ao Terminal (Git Bash) na pasta do projeto Unity (`D:\Unity-Projects\GLW`).
2. Associe o repositório remoto (dando-lhe o nome `glw` ou `usb`):

   ```bash
   git remote add glw "E:/Git/GLW.git"
   ```

3. Confirme se o remoto ficou corretamente reconhecido:

   ```bash
   git remote -v
   ```
   *(Se o resultado apresentar duas linhas, fetch e push, a apontar para `E:/Git/GLW.git`, a associação foi bem-sucedida).*

### Passo 4: Resolver o erro de segurança de permissões (Dubious Ownership)

Ao enviar código para um disco formatado em exFAT ou FAT32, o Git apresentará o erro `"dubious ownership"`, uma vez que estes sistemas de ficheiros não guardam permissões de utilizador como o NTFS, o que leva o Git a considerar o repositório como sem proprietário e a bloqueá-lo por motivos de segurança.

**Como resolver:** Adicione explicitamente essa pasta à lista de diretórios seguros do Git:

```bash
git config --global --add safe.directory "E:/Git/GLW.git"
```

### Passo 5: Enviar (push) o código para o disco externo

Quando tudo estiver devidamente configurado, execute os comandos abaixo para enviar todos os ramos (branches) e etiquetas (tags), assegurando uma cópia de segurança integral a 100% do projeto:

```bash
git push glw --all
git push glw --tags
```
*(Aguarde que o processo termine e o seu projeto ficará salvaguardado em segurança no disco externo).*

---

## 3. Erros mais frequentes (Resolução de problemas)

### 3.1. Erro ao criar um nome de pasta incorreto (Nomes colados)

- **Sintoma:** Ao executar `mkdir -p E:\Git\GLW.git` através do Git Bash, a pasta criada fica com o nome `GitGLW.git`.
- **Causa:** O Git Bash interpreta o caráter `\` como um caráter de escape. Ignora o símbolo `\` e une `Git` com `GLW`, resultando em `GitGLW`.
- **Como resolver:** Utilize sempre barras oblíquas `/` ou aspas ao indicar caminhos no Git Bash (por ex., `mkdir -p "E:/Git/GLW.git"`).

### 3.2. Erro `"fatal: 'E:BackupGitGLW.git' does not appear to be a git repository"`

- **Sintoma:** O Git indica que não encontra o repositório remoto ao efetuar o push.
- **Causa:** Ao executar o comando `git remote add`, utilizou barras invertidas (`\`), corrompendo o caminho guardado.
- **Como resolver:**
  1. Remova a configuração incorreta do remoto:

     ```bash
     git remote remove glw
     ```

  2. Adicione novamente o remoto com o caminho correto:

     ```bash
     git remote add glw "E:/Git/GLW.git"
     ```
     *(Pode também usar `git remote set-url glw "E:/Git/GLW.git"` para o substituir).*

### 3.3. Esquecer-se de inicializar o Bare Repo

- **Sintoma:** Mesmo com o caminho do remoto correto, o push continua a falhar com a mensagem `Could not read from remote repository`.
- **Causa:** O comando `git init --bare` não foi executado dentro da pasta no disco externo.
- **Como resolver:** Abra o Explorador de Ficheiros, navegue até à pasta no disco externo, clique com o botão direito do rato, escolha **Open Git Bash here** e execute o comando `git init --bare`.
