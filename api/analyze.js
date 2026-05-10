export const config = { api: { bodyParser: { sizeLimit: '12mb' } } };

export default async function handler(req, res) {

  // CORS — permite chamadas do seu domínio
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { modelo, medicos, contrato, diretor, fileName, fileBase64, fileType } = req.body;

    if (!fileBase64) {
      return res.status(400).json({
        status: 'INSUFICIENTE',
        titulo: 'Contrato não enviado',
        resumo: 'Não há informações suficientes para determinar se a clínica está em conformidade com as resoluções do CREMESP. O envio do contrato é indispensável para a análise preliminar.',
        pontos: [],
        observacoes: 'Indicado o contato com especialista jurídico para diagnóstico específico.'
      });
    }

    // Monta o conteúdo para o Claude
    const userContent = [];

    // Anexa o contrato
    const isPdf = fileType === 'application/pdf' || (fileName || '').toLowerCase().endsWith('.pdf');
    userContent.push({
      type: 'document',
      source: {
        type: 'base64',
        media_type: isPdf
          ? 'application/pdf'
          : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        data: fileBase64
      }
    });

    // Instrução de análise
    userContent.push({
      type: 'text',
      text: `Leia o contrato acima na íntegra e gere o diagnóstico de compliance com base exclusivamente no que está escrito nele.

INFORMAÇÕES DECLARADAS PELA CLÍNICA:
- Modelo de contratação: ${modelo || 'Não informado'}
- Número de profissionais médicos: ${medicos || 'Não informado'}
- Confirma existência de contrato formal: ${contrato || 'Não informado'}
- Diretor Técnico: ${diretor || 'Não informado'}
- Nome do arquivo enviado: ${fileName || 'Não informado'}

Cada ponto do diagnóstico deve ser redigido com base no que você encontrou (ou não encontrou) neste contrato específico. Não use textos pré-definidos. Responda em JSON conforme especificado.`
    });

    // Chama a API da Anthropic
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2000,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userContent }]
      })
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err?.error?.message || `Anthropic HTTP ${response.status}`);
    }

    const data = await response.json();
    const raw = data.content?.[0]?.text || '{}';
    const clean = raw.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '').trim();
    const result = JSON.parse(clean);

    return res.status(200).json(result);

  } catch (err) {
    console.error('analyze error:', err);
    return res.status(500).json({
      status: 'ERRO',
      titulo: 'Não foi possível concluir a análise',
      resumo: 'Ocorreu um erro ao processar o documento. Tente novamente ou entre em contato com a equipe GTB Law para análise direta.',
      pontos: [],
      observacoes: null
    });
  }
}

// ─── SYSTEM PROMPT ───────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `Você é um assistente jurídico especializado em direito médico e compliance contratual no estado de São Paulo.

Você receberá o texto de um contrato médico (PDF ou DOCX) e informações básicas da clínica. Sua tarefa é ler o contrato integralmente e identificar, com base no que está EFETIVAMENTE escrito no documento, os pontos de conformidade e desconformidade com:

1. Resolução CREMESP 397/2026 — autonomia técnica médica, indicação e regularidade do Diretor Técnico, responsabilidade técnica, modelos de contratação permitidos
2. Código de Ética Médica (CFM) — preservação da autonomia profissional, sigilo médico e prontuário
3. Resoluções CFM 1638/2002 e 2218/2018 — prontuário médico: guarda, acesso e responsabilidade
4. LGPD (Lei 13.709/2018) — tratamento de dados sensíveis de saúde, base legal, responsável pelo tratamento
5. CLT — sinais de subordinação que possam caracterizar vínculo empregatício não declarado

Para cada item abaixo, leia o contrato e determine se está presente, ausente ou incompleto. Redija cada ponto com base no que você ENCONTROU (ou não encontrou) no documento — nunca use textos genéricos ou pré-definidos:

ITENS A VERIFICAR NO CONTRATO:
— Natureza e objeto da prestação de serviços (como está descrita)
— Local de trabalho (fixo, variável, determinado ou indeterminado)
— Horário, jornada ou escala (prevista ou não)
— Sinais de subordinação direta: ordens, controle de frequência, exclusividade
— Forma de remuneração (fixa, variável, por produção, salário)
— Periodicidade e data de pagamento
— Prazo de vigência e condições de renovação
— Regras de rescisão e prazo de notificação prévia
— Definição de responsabilidades de cada parte
— Cláusula expressa de autonomia técnica médica
— Indicação formal do Diretor Técnico e menção à regularidade perante o CREMESP
— Existência de SCP ou referência a modelo societário
— Cláusula sobre prontuário médico e sigilo profissional
— Cláusula LGPD / confidencialidade / proteção de dados

IMPORTANTE:
- Cada ponto deve descrever especificamente o que foi encontrado ou a ausência identificada NO CONTRATO ANALISADO
- Não use frases genéricas ou padrão. Referencie o que o contrato diz ou deixa de dizer
- Se uma cláusula existe mas é insuficiente, diga o que falta especificamente
- Se uma cláusula está adequada, confirme e descreva brevemente
- O resumo deve ser específico para este contrato, não genérico

Responda SOMENTE em JSON válido, sem markdown, sem texto fora do JSON:
{
  "status": "CONFORME" | "DESCONFORME" | "INSUFICIENTE",
  "titulo": "frase descritiva de até 10 palavras sobre este contrato específico",
  "resumo": "síntese objetiva de até 40 palavras sobre o que foi encontrado neste contrato",
  "pontos": [
    {
      "tipo": "critico" | "atencao" | "ok",
      "texto": "descrição específica baseada no conteúdo do contrato analisado — mínimo 10, máximo 30 palavras"
    }
  ],
  "observacoes": "observação técnica adicional específica para este contrato, se relevante — até 2 frases"
}

Classificação:
- "critico": ausência ou redação que gera risco regulatório direto
- "atencao": presente mas com lacunas ou imprecisões que merecem revisão
- "ok": cláusula existente e adequada às exigências regulatórias`;
