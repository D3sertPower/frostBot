# frostBot - Stay frosty! Steam P2P trading made safe and easy.

## Por que JavaScript?

O pacote `steam-user` implementa o protocolo de cliente da Steam, mantém a
conexão e expõe os eventos e métodos de chat de que este bot precisa. Para este
caso, ele evita recriar autenticação, reconexão e mensagens do protocolo na mão.

## Requisitos

- Node.js 18 ou superior
- Uma conta Steam destinada ao bot
- Steam Guard acessível no primeiro login

## Instalação

No terminal, dentro desta pasta:

```bash
npm install
```

Copie `.env.example` para `.env`:

### Windows (PowerShell)

```powershell
Copy-Item .env.example .env
```

### Linux/macOS

```bash
cp .env.example .env
```

Abra `.env` e preencha o **nome usado para entrar na Steam**, não o nome público
do perfil:

```dotenv
STEAM_ACCOUNT_NAME=seu_usuario_de_login
STEAM_PASSWORD=sua_senha
```

O `.env` e os dados locais de autenticação estão no `.gitignore`. Nunca envie
esses arquivos para GitHub, Discord ou outra pessoa.

O projeto também fixa versões corrigidas de duas dependências transitivas de
`steam-user` por meio de `overrides`; não remova esse bloco do `package.json`
sem antes executar `npm audit` e os testes.

## Executar

```bash
npm start
```

No primeiro login, o terminal solicitará o código do Steam Guard. Depois de
`Conectado à Steam`, envie `!hello` para a conta do bot a partir de uma conta que
seja amiga dela. A resposta será `Hello!`.

Para encerrar, use `Ctrl+C`.

## Testar sem entrar na Steam

```bash
npm test
```

## Estrutura

- `src/index.js`: conexão, autenticação, eventos e envio da resposta
- `src/message-handler.js`: interpretação dos comandos
- `test/message-handler.test.js`: testes do comando sem acessar a Steam
- `data/`: criada em execução para dados locais da sessão; não versionada

## Cuidados

- Use preferencialmente uma conta separada da sua conta pessoal.
- Não rode duas instâncias com a mesma conta.
- Não remova `data/` entre execuções se quiser preservar a autorização local.
- Este projeto usa uma biblioteca comunitária e não a Steam Web API oficial;
  evite spam e automações que violem os termos da Steam.