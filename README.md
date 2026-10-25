# Apuração ao vivo · 2º turno presidencial 2026

Painel: **https://pfoziliani.github.io/eleicao-2026-2turno/**

Lula × Flávio Bolsonaro com dados oficiais do TSE (`resultados.tse.jus.br`, eleições 6257 e 6258):
percentuais ao vivo, variação em relação ao 1º turno nos mesmos municípios já apurados, estimativa de
transferência de votos (dos outros candidatos, brancos/nulos e abstenção), previsão de vitória e como cada
região moveu a apuração ao longo da noite.

- `site/` — o painel (HTML/JS estático, sem dependências). O navegador lê o TSE diretamente a cada 30 s.
- `site/data/r1.json` — resultado do 1º turno por município (base fixa).
- `site/data/r2-mun.json`, `site/data/timeline.json` — 2º turno por município e capturas da apuração,
  atualizados pelo workflow **Live recorder** (`recorder/cloud.mjs`), que consulta o TSE e republica a cada ~2 min.
  O agendamento se desliga sozinho depois da apuração (26/10/2026).

Painel não oficial. Método detalhado no rodapé da página.
