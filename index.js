require('dotenv').config();
const fs = require('fs');
const {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
} = require('discord.js');

console.log(
  'TOKEN LIDO:',
  process.env.DISCORD_TOKEN ? '[OK - existe]' : '[NÃO ENCONTRADO]'
);
console.log('Node version:', process.version);

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel],
});

// -------- MAPEAMENTO DAS MATÉRIAS --------
// Ajusta esses aliases para bater com o nome dos seus canais de voz
const MATERIAS = {
  portugues: ['portugues', 'português', 'port', 'pt'],
  matematica: ['matematica', 'matemática', 'mat'],
  filosofia_historia: [
    'filosofia',
    'historia',
    'história',
    'filosofia/historia',
    'filosofia/história',
  ],
  ciencias: [
    'ciencias da natureza',
    'ciências da natureza',
    'ciencias',
    'ciência',
    'cn',
  ],
  diversos: ['diversos', 'geral', 'outros'],
};

const LABEL_MATERIA = {
  portugues: 'Português',
  matematica: 'Matemática',
  filosofia_historia: 'Filosofia/História',
  ciencias: 'Ciências da Natureza',
  diversos: 'Diversos',
};

const EMOJI_MATERIA = {
  portugues: '📗',
  matematica: '📘',
  filosofia_historia: '📙',
  ciencias: '📒',
  diversos: '📚',
};

// -------- CONFIG DOS CARGOS POR HORAS DE ESTUDO --------
// Troque esses IDs pelos IDs REAIS dos cargos no seu servidor
const ROLE_TIERS = [
  {
    nome: 'Burro',
    roleId: '1442646450067472565',
    minHoras: 0,
  },
  {
    nome: 'Mediocre',
    roleId: '1442646692552900669',
    minHoras: 100,
  },
  {
    nome: 'Aprendiz',
    roleId: '1442646900418547823',
    minHoras: 500,
  },
  {
    nome: 'Inteligente',
    roleId: '1442646946400440433',
    minHoras: 5000,
  },
  {
    nome: 'Mago Implacavel',
    roleId: '1442647104815239218',
    minHoras: 10000,
  },
];

// ---- LOGS DE ERRO (pra debug se der ruim) ----
client.on('error', (err) => console.error('client error:', err));
process.on('unhandledRejection', (reason) =>
  console.error('unhandledRejection:', reason)
);
process.on('uncaughtException', (err) =>
  console.error('uncaughtException:', err)
);

// ---------- CARREGAR ARQUIVO JSON ----------
let tempoGlobal = {}; // userID -> ms total (todas matérias)
let tempoMateria = {}; // materia -> { userID -> ms }

try {
  const dado = fs.readFileSync('tempo.json', 'utf8');
  const json = JSON.parse(dado);

  if (json.global || json.materias) {
    tempoGlobal = json.global || {};
    tempoMateria = json.materias || {};
  } else {
    // formato antigo (apenas global)
    tempoGlobal = json;
    tempoMateria = {};
  }
} catch (err) {
  console.log(
    'Arquivo tempo.json não encontrado ou inválido, criando novo.'
  );
  tempoGlobal = {};
  tempoMateria = {};
}

// Guarda o horário atual de cada usuário na call (sessão atual)
let entradaEmCall = {}; // userID → { inicio, materia }

//------------------------------------------------------
client.once('ready', () => {
  console.log(`🤖 Bot conectado como ${client.user.tag}`);
});
//------------------------------------------------------

// Quando alguém entrar no servidor: dá o cargo inicial (Burro)
client.on('guildMemberAdd', async (member) => {
  const tierBurro = ROLE_TIERS[0];
  if (!tierBurro || !tierBurro.roleId) return;

  if (!member.roles.cache.has(tierBurro.roleId)) {
    await member.roles.add(tierBurro.roleId).catch(() => {});
    console.log(
      `👋 Novo membro ${member.user.tag} recebeu cargo inicial: ${tierBurro.nome}`
    );
  }
});

// ---------- FUNÇÕES AUXILIARES DE MATÉRIA ------------

function normalizarTexto(str) {
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

// Descobre qual matéria é, baseado no nome do canal de voz
function detectarMateriaDoCanal(channel) {
  if (!channel || !channel.name) return null;
  const nome = normalizarTexto(channel.name);

  for (const [materia, aliases] of Object.entries(MATERIAS)) {
    for (const alias of aliases) {
      if (nome.includes(normalizarTexto(alias))) {
        return materia;
      }
    }
  }
  return null; // canal sem matéria mapeada (ex: AFK)
}

// Resolve texto digitado no comando para uma matéria
function resolverMateriaPorTexto(texto) {
  if (!texto) return null;
  const t = normalizarTexto(texto);

  for (const [materia, aliases] of Object.entries(MATERIAS)) {
    for (const alias of aliases) {
      if (t === normalizarTexto(alias)) return materia;
    }
  }
  return null;
}

// ---------- EVENTOS DE VOZ -------------

function iniciarSessao(userId, channel) {
  const materia = detectarMateriaDoCanal(channel);
  entradaEmCall[userId] = {
    inicio: Date.now(),
    materia,
  };
  console.log(
    `➡️ ${userId} entrou em call (${
      materia ? LABEL_MATERIA[materia] : 'sem matéria'
    }).`
  );
}

function finalizarSessao(userId, guild) {
  const sessao = entradaEmCall[userId];
  if (!sessao) return;

  const agora = Date.now();
  const duracao = agora - sessao.inicio;

  // soma no global
  tempoGlobal[userId] = (tempoGlobal[userId] || 0) + duracao;

  // soma na matéria (se houver)
  if (sessao.materia) {
    if (!tempoMateria[sessao.materia]) tempoMateria[sessao.materia] = {};
    tempoMateria[sessao.materia][userId] =
      (tempoMateria[sessao.materia][userId] || 0) + duracao;
  }

  console.log(
    `⬅️ ${userId} saiu. Sessão: ${msParaTexto(duracao)}${
      sessao.materia ? ` | Matéria: ${LABEL_MATERIA[sessao.materia]}` : ''
    }`
  );

  delete entradaEmCall[userId];
  salvarArquivo();

  if (guild) {
    atualizarCargoEstudo(guild, userId).catch(() => {});
  }
}

client.on('voiceStateUpdate', (oldState, newState) => {
  const userId = newState.id;
  const antes = oldState.channel;
  const depois = newState.channel;

  // Entrou em algum canal (não estava em call)
  if (!antes && depois) {
    iniciarSessao(userId, depois);
  }
  // Saiu de todos os canais
  else if (antes && !depois) {
    finalizarSessao(userId, oldState.guild);
  }
  // Trocou de canal
  else if (antes && depois && antes.id !== depois.id) {
    finalizarSessao(userId, oldState.guild);
    iniciarSessao(userId, depois);
  }
});

//------------ COMANDOS --------------------
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (!message.guild) return;

  const prefix = '!';
  if (!message.content.startsWith(prefix)) return;

  const args = message.content.slice(prefix.length).trim().split(/\s+/);
  const comando = args.shift()?.toLowerCase();

  // ---------- COMANDO !tempo ----------
  if (comando === 'tempo') {
    let materiaArg = null;
    let alvo = null;

    if (message.mentions.users.size > 0) {
      alvo = message.mentions.users.first();
      // remove menção da lista de args
      for (let i = 0; i < args.length; i++) {
        if (args[i].startsWith('<@') && args[i].endsWith('>')) {
          args.splice(i, 1);
          break;
        }
      }
    }

    if (!alvo) alvo = message.author;

    if (args.length > 0) {
      materiaArg = resolverMateriaPorTexto(args.join(' '));
      if (!materiaArg) {
        return message.reply(
          '❓ Não reconheci essa matéria. Exemplos: `!tempo matematica`, `!tempo portugues`.'
        );
      }
    }

    let total = 0;
    if (materiaArg) {
      total = getTotalTimeMateriaUsuario(alvo.id, materiaArg);
    } else {
      total = getTotalTimeGlobalUsuario(alvo.id);
    }

    if (total === 0) {
      if (alvo.id === message.author.id) {
        return message.reply(
          '⏱️ Você ainda não tem tempo registrado nesse filtro.'
        );
      } else {
        return message.reply(
          `⏱️ ${alvo.username} ainda não tem tempo registrado nesse filtro.`
        );
      }
    }

    const textoTempo = msParaTexto(total);
    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setAuthor({
        name: alvo.username,
        iconURL: alvo.displayAvatarURL(),
      })
      .setFooter({ text: 'BotTempoCall – estudo monitorado 😎' });

    if (materiaArg) {
      const label = LABEL_MATERIA[materiaArg] || materiaArg;
      const emoji = EMOJI_MATERIA[materiaArg] || '📚';
      embed
        .setTitle(`${emoji} Tempo de estudo em ${label}`)
        .setDescription(`**${textoTempo}** em canais de **${label}**.`);
    } else {
      embed
        .setTitle('⏱️ Tempo total em call (todas as matérias)')
        .setDescription(`Você já passou **${textoTempo}** em call.`);
    }

    return message.reply({ embeds: [embed] });
  }

  // ---------- COMANDO !rank / !ranking ----------
  if (comando === 'rank' || comando === 'ranking') {
    let materiaArg = null;

    if (args.length > 0) {
      materiaArg = resolverMateriaPorTexto(args.join(' '));
      if (!materiaArg) {
        return message.reply(
          '❓ Não reconheci essa matéria.\nExemplos: `!rank matematica`, `!rank portugues` ou só `!rank` para geral.'
        );
      }
    }

    let ranking;
    if (materiaArg) {
      ranking = await montarRankingMateria(message.guild, materiaArg);
    } else {
      ranking = await montarRankingGlobal(message.guild);
    }

    if (!ranking || ranking.length === 0) {
      return message.reply(
        '📊 Ainda não há dados suficientes para montar o ranking.'
      );
    }

    const max = ranking[0].total;
    const linhas = ranking
      .map((item, idx) => {
        const barra = barraProgresso(item.total / max);
        return (
          `**${idx + 1}.** ${item.nome} — \`${msParaTexto(
            item.total
          )}\`\n${barra}`
        );
      })
      .join('\n\n');

    const pos = ranking.findIndex((r) => r.id === message.author.id);
    let linhaPos = '';
    if (pos !== -1) {
      linhaPos = `\n\n👤 Sua posição: **${pos + 1}º** — \`${msParaTexto(
        ranking[pos].total
      )}\``;
    }

    const totalGeralMs = ranking.reduce((acc, r) => acc + r.total, 0);
    const totalGeralTxt = msParaTexto(totalGeralMs);

    let titulo = '🏆 Ranking geral de tempo em call';
    let emoji = '🏆';
    if (materiaArg) {
      const label = LABEL_MATERIA[materiaArg] || materiaArg;
      emoji = EMOJI_MATERIA[materiaArg] || emoji;
      titulo = `${emoji} Ranking de ${label}`;
    }

    const embed = new EmbedBuilder()
      .setColor(0xf1c40f)
      .setTitle(titulo)
      .setDescription(linhas + linhaPos)
      .setFooter({
        text: `Tempo total somado desse ranking: ${totalGeralTxt}`,
      });

    return message.reply({ embeds: [embed] });
  }

  // ---------- COMANDO !cargo ----------
  if (comando === 'cargo') {
    const user = message.author;
    const totalMs = getTotalTimeGlobalUsuario(user.id);
    const horas = totalMs / (1000 * 60 * 60);

    // calcula tier atual
    let tierAtual = ROLE_TIERS[0];
    for (const tier of ROLE_TIERS) {
      if (horas >= tier.minHoras) {
        tierAtual = tier;
      }
    }

    // próximo tier
    const proximos = ROLE_TIERS.filter((t) => t.minHoras > tierAtual.minHoras);
    let proximo = null;
    if (proximos.length > 0) {
      proximos.sort((a, b) => a.minHoras - b.minHoras);
      proximo = proximos[0];
    }

    const embed = new EmbedBuilder()
      .setColor(0x2ecc71)
      .setTitle('🎓 Seu nível de estudo')
      .setAuthor({
        name: user.username,
        iconURL: user.displayAvatarURL(),
      })
      .addFields(
        {
          name: 'Nível atual',
          value: `**${tierAtual.nome}**`,
          inline: true,
        },
        {
          name: 'Horas totais de estudo',
          value: `**${horas.toFixed(2)}h**`,
          inline: true,
        }
      )
      .setFooter({
        text: 'Suba de nível estudando mais tempo em call 📚',
      });

    if (proximo) {
      const falta = Math.max(0, proximo.minHoras - horas);
      embed.addFields({
        name: 'Próximo nível',
        value: `**${proximo.nome}** em **${falta.toFixed(
          2
        )}h** (${proximo.minHoras}h no total)`,
      });
    } else {
      embed.addFields({
        name: 'Próximo nível',
        value: 'Você já está no nível máximo: **Mago Implacavel** 🧙‍♂️',
      });
    }

    return message.reply({ embeds: [embed] });
  }
});

// --------- FUNÇÕES DE TEMPO POR USUÁRIO ------------

function getTotalTimeGlobalUsuario(userId) {
  let total = tempoGlobal[userId] || 0;
  const sessao = entradaEmCall[userId];
  if (sessao) {
    total += Date.now() - sessao.inicio;
  }
  return total;
}

function getTotalTimeMateriaUsuario(userId, materia) {
  let total = 0;
  if (tempoMateria[materia] && tempoMateria[materia][userId]) {
    total += tempoMateria[materia][userId];
  }
  const sessao = entradaEmCall[userId];
  if (sessao && sessao.materia === materia) {
    total += Date.now() - sessao.inicio;
  }
  return total;
}

// --------- ATUALIZAR CARGO POR HORAS --------
async function atualizarCargoEstudo(guild, userId) {
  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member) return;

  const totalMs = getTotalTimeGlobalUsuario(userId);
  const horas = totalMs / (1000 * 60 * 60);

  let tierAlvo = ROLE_TIERS[0];
  for (const tier of ROLE_TIERS) {
    if (horas >= tier.minHoras) tierAlvo = tier;
  }

  const rolesDoEstudo = ROLE_TIERS.map((t) => t.roleId);
  const rolesAtuais = member.roles.cache;

  const jaTem = rolesAtuais.has(tierAlvo.roleId);
  if (jaTem) return;

  // remove todos os tiers antigos
  const rem = rolesDoEstudo.filter((id) => rolesAtuais.has(id));
  if (rem.length > 0) {
    await member.roles.remove(rem).catch(() => {});
  }

  // adiciona o correto
  if (tierAlvo.roleId) {
    await member.roles.add(tierAlvo.roleId).catch(() => {});
  }

  console.log(
    `🎓 ${member.user.tag} agora é ${tierAlvo.nome} (${horas.toFixed(2)}h)`
  );
}

// --------- FUNÇÕES DE RANKING ------------

async function montarRankingGlobal(guild) {
  const ids = new Set([
    ...Object.keys(tempoGlobal),
    ...Object.keys(entradaEmCall),
  ]);

  const lista = [];
  for (const id of ids) {
    const total = getTotalTimeGlobalUsuario(id);
    if (total <= 0) continue;

    let nome = `<@${id}>`;
    try {
      const member = await guild.members.fetch(id);
      nome = member.displayName || member.user.username || nome;
    } catch (_) {}

    lista.push({ id, nome, total });
  }

  lista.sort((a, b) => b.total - a.total);
  return lista.slice(0, 10);
}

async function montarRankingMateria(guild, materia) {
  const base = tempoMateria[materia] || {};
  const ids = new Set([
    ...Object.keys(base),
    ...Object.keys(entradaEmCall).filter(
      (id) => entradaEmCall[id].materia === materia
    ),
  ]);

  const lista = [];
  for (const id of ids) {
    const total = getTotalTimeMateriaUsuario(id, materia);
    if (total <= 0) continue;

    let nome = `<@${id}>`;
    try {
      const member = await guild.members.fetch(id);
      nome = member.displayName || member.user.username || nome;
    } catch (_) {}

    lista.push({ id, nome, total });
  }

  lista.sort((a, b) => b.total - a.total);
  return lista.slice(0, 10);
}

// --------- SALVAR EM ARQUIVO ---------------
function salvarArquivo() {
  const json = {
    global: tempoGlobal,
    materias: tempoMateria,
  };
  fs.writeFileSync('tempo.json', JSON.stringify(json, null, 2));
  console.log('💾 tempo.json atualizado.');
}

// --------- FORMATAR TEMPO ---------------
function msParaTexto(ms) {
  const totalSegundos = Math.floor(ms / 1000);
  const h = String(Math.floor(totalSegundos / 3600)).padStart(2, '0');
  const m = String(Math.floor((totalSegundos % 3600) / 60)).padStart(2, '0');
  const s = String(totalSegundos % 60).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

// --------- BARRA DE PROGRESSO ------------
function barraProgresso(fracao) {
  if (fracao < 0) fracao = 0;
  if (fracao > 1) fracao = 1;
  const totalBlocos = 20;
  const cheios = Math.max(1, Math.round(fracao * totalBlocos));
  const vazios = totalBlocos - cheios;
  return '```' + '█'.repeat(cheios) + '░'.repeat(vazios) + '```';
}

// --------- LOGIN DO BOT ---------------
client.login(process.env.DISCORD_TOKEN);
