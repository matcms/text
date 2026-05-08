## Problema

A configuração de pausa em segundos (`messagePauseSec`) não está sendo respeitada literalmente. No `playAnimation` (`src/components/ChatStoryGenerator.tsx`, linhas 340–378) há valores fixos que ignoram o input do usuário, fazendo parecer que o controle "não funciona":

1. **Linha 355** — `setTimeout(400)` fixo entre cada chat.
2. **Linha 369** — para mensagens sem áudio: `Math.max(800, pauseMs * 3)` força mínimo de **800ms** e ainda multiplica a pausa por 3.
3. **Linhas 371–373** — aplica `pauseMs` extra DEPOIS da espera anterior, acumulando pausas em dobro.

Resultado: mesmo configurando `0,1s`, sempre há pelo menos ~0.8s–1.2s de pausa real entre mensagens.

## Correção

Reescrever a lógica de tempo para que o valor em segundos seja o tempo real entre mensagens — nada mais, nada menos.

Regra simples e literal:
- `0,1s` configurado → 100ms entre mensagens (quase sem pausa).
- `1s` configurado → 1000ms entre mensagens.
- `0s` configurado → mensagens emendadas, sem pausa nenhuma.
- Áudio TTS toca normalmente; a pausa configurada é aplicada **após** o fim do áudio (não somada com mínimos fixos).

## Mudanças em `src/components/ChatStoryGenerator.tsx`

- **Linha 355**: trocar `setTimeout(r, 400)` por `setTimeout(r, pauseMs)` na transição entre chats.
- **Linha 369**: trocar `Math.max(800, pauseMs * 3)` por apenas `pauseMs`.
- **Linhas 371–373**: remover a pausa extra acumulada (a pausa única já é aplicada no passo anterior).
- Para mensagens com áudio: aguardar `onended` e então aplicar exatamente `pauseMs` (sem somar mínimos).
- Verificar o input numérico no painel (≈ linha 625) para garantir `min={0}` e `step={0.1}`, permitindo valores como `0`, `0.1`, `0.5`, `1`, etc.

## Resultado esperado

O controle "Pausa entre mensagens (s)" passa a refletir exatamente o tempo configurado, tornando o vídeo tão dinâmico quanto o usuário quiser.