---
title: "Guia para fazer backup de projetos Unity para um HD externo com Git Bare Repository"
date: 2026-08-22 10:00:00 +0700
categories: [Game Development, Unity]
tags: [git, backup, unity, bare-repository, usb]
description: "Guia passo a passo para configurar um Git Bare Repository em um HD externo (USB) com Git LFS, fazer backup seguro de projetos Unity e corrigir os erros mais comuns."
lang: pt-BR
translation_id: unity-git-bare-repository-usb-backup
---

Este guia reúne todo o fluxo de trabalho, os comandos exatos e os erros mais comuns ao configurar um **Bare Git Repository** em um HD externo portátil (USB) para servir como um local seguro de cópia de segurança (backup) para o seu projeto Unity.

## 1. Introdução ao Bare Repository

- Um **Bare Repository** é um repositório Git sem diretório de trabalho (working directory), ou seja, ele não possui os arquivos de código diretamente visíveis para visualizar ou editar. Ele armazena apenas o conteúdo da pasta oculta `.git`.
- Seu principal objetivo é **receber código enviado via push** a partir de outros computadores, funcionando de forma semelhante a um servidor GitHub ou GitLab local no seu HD externo.

## 2. Procedimento de configuração correto (Passo a passo)

### Passo 1: Ativar o Git LFS para o projeto Unity (Local)

Projetos Unity contêm muitos arquivos binários grandes (imagens, áudio, modelos 3D). Para que o Git os processe da melhor forma, o uso do `Git LFS` é obrigatório.

1. Abra o Terminal (Git Bash) na pasta do seu projeto Unity (por exemplo, `D:\Unity-Projects\GLW`).
2. Baixe o template `.gitattributes` padrão do GameCI para Unity.
3. Execute o comando para inicializar o LFS:

   ```bash
   git lfs install
   ```

4. Adicione o arquivo de configuração ao histórico do Git:

   ```bash
   git add .gitattributes
   git commit -m "Adicionar configuração gitattributes para Unity e Git LFS"
   ```

### Passo 2: Criar o Bare Repo no HD externo

1. Conecte o HD externo ao computador (supondo que o sistema o reconheça como unidade `E:`).
2. Abra o **Git Bash** e navegue até a pasta onde deseja armazenar o backup (por exemplo, `E:\Git`):

   ```bash
   cd /e/Git
   ```

3. Crie a pasta que abrigará o repositório (seguindo a convenção do sufixo `.git`).

   > [!IMPORTANT]
   > **Aviso extremamente importante:** No Git Bash você deve usar a barra normal `/`, e não a barra invertida `\` do Windows.

   ```bash
   mkdir -p "GLW.git"
   ```

4. Acesse a pasta recém-criada e inicialize o Bare Repo:

   ```bash
   cd "GLW.git"
   git init --bare
   ```

### Passo 3: Vincular o projeto Unity ao HD externo (Adicionar Remote)

1. Volte ao Terminal (Git Bash) na pasta do projeto Unity (`D:\Unity-Projects\GLW`).
2. Adicione o remote (dando o nome de `glw` ou `usb`):

   ```bash
   git remote add glw "E:/Git/GLW.git"
   ```

3. Verifique se o remote foi configurado corretamente:

   ```bash
   git remote -v
   ```
   *(Se o resultado exibir 2 linhas — fetch e push — apontando para `E:/Git/GLW.git`, deu tudo certo).*

### Passo 4: Corrigir o erro de segurança de permissões (Dubious Ownership)

Ao enviar código para um HD formatado em exFAT ou FAT32, o Git exibirá o erro `"dubious ownership"`, pois esses sistemas de arquivos não armazenam permissões de usuário como o NTFS, fazendo com que o Git interprete o repositório como sem dono e o bloqueie por motivos de segurança.

**Como resolver:** Adicione a pasta à lista de diretórios seguros do Git:

```bash
git config --global --add safe.directory "E:/Git/GLW.git"
```

### Passo 5: Enviar (push) o código para o HD externo

Com tudo configurado, execute os comandos abaixo para enviar todas as branches e tags e garantir o backup completo (100%) do projeto:

```bash
git push glw --all
git push glw --tags
```
*(Aguarde o término do processo e o seu projeto estará salvo com segurança no HD externo).*

---

## 3. Erros mais comuns (Solução de problemas)

### 3.1. Erro ao criar nome de pasta errado (Nomes grudados)

- **Sintoma:** Ao executar `mkdir -p E:\Git\GLW.git` no Git Bash, a pasta criada fica com o nome `GitGLW.git`.
- **Causa:** O Git Bash interpreta o caractere `\` como um caractere de escape. Ele ignora o símbolo `\` e junta `Git` com `GLW`, formando `GitGLW`.
- **Como resolver:** Sempre utilize barras normais `/` ou aspas ao informar caminhos no Git Bash (por exemplo, `mkdir -p "E:/Git/GLW.git"`).

### 3.2. Erro `"fatal: 'E:BackupGitGLW.git' does not appear to be a git repository"`

- **Sintoma:** O Git informa que não encontrou o repositório remoto ao tentar fazer o push.
- **Causa:** Ao executar o comando `git remote add`, você usou barras invertidas (`\`), corrompendo o caminho salvo.
- **Como resolver:**
  1. Remova a configuração incorreta do remote:

     ```bash
     git remote remove glw
     ```

  2. Adicione novamente o remote usando o formato correto:

     ```bash
     git remote add glw "E:/Git/GLW.git"
     ```
     *(Você também pode usar `git remote set-url glw "E:/Git/GLW.git"` para sobrescrevê-lo).*

### 3.3. Esquecer de inicializar o Bare Repo

- **Sintoma:** Mesmo com o caminho do remote correto, o push continua falhando com a mensagem `Could not read from remote repository`.
- **Causa:** O comando `git init --bare` não foi executado dentro da pasta no HD externo.
- **Como resolver:** Abra o Explorador de Arquivos, navegue até a pasta no HD externo, clique com o botão direito, selecione **Open Git Bash here** e execute o comando `git init --bare`.
