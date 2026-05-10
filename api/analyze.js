export const config = { api: { bodyParser: { sizeLimit: '12mb' } } };

export default async function handler(req, res) {

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

    const userContent = [];
    const isPdf = fileType === 'application/pdf' || (fileName || '').toLowerCase().endsWith('.pdf');

    if (isPdf) {
      // PDF: Claude lê nativamente
      userContent.push({
        type: 'document',
        source: { type: 'base64', media_type: 'application/pdf', data: fileBase64 }
      });
    } else {
      // DOCX: extrai texto das tags XML internas
      let docText = '';
      try {
        const buf = Buffer.from(fileBase64, 'base64');
        const raw = buf.toString('latin1', 0, Math.min(buf.length, 800000));
        const matches = raw.match(/<w:t[^>]*>([^<]+)<\/w:t>/g) || [];
        docText = matches.map(m => m.replace(/<[^>]+>/g, '')).join(' ').replace(/\s+/g, ' ').trim();
      } catch(e) { docText = ''; }

      userContent.push({
        type: 'text',
        text: docText.length > 100
          ? `CONTEÚDO DO CONTRATO (${fileName}):\n\n${docText.substring(0, 50000)}`
          : `O arquivo "${fileName}" foi enviado mas não foi possível extrair seu conteúdo. Gere o diagnóstico com base apenas nas informações do questionário e indique que a leitura do documento não foi possível.`
      });
    }

    userContent.push({
      type: 'text',
      text: `Leia o contrato acima e gere o diagnóstico de compliance.

INFORMAÇÕES DA CLÍNICA:
- Modelo de contratação: ${modelo || 'Não informado'}
- Número de médicos: ${medicos || 'Não informado'}
- Contrato formal: ${contrato || 'Não informado'}
- Diretor Técnico: ${diretor || 'Não informado'}
- Arquivo: ${fileName || 'Não informado'}

Responda em JSON conforme especificado no system prompt.`
    });

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
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
    return res.status(200).json(JSON.parse(clean));

  } catch (err) {
    console.error('analyze error:', err);
    return res.status(500).json({
      status: 'ERRO',
      titulo: 'Não foi possível concluir a análise',
      resumo: 'Ocorreu um erro ao processar o documento. Tente novamente ou entre em contato com a equipe GTB Law.',
      pontos: [],
      observacoes: null
    });
  }
}

const SYSTEM_PROMPT = `Você é um assistente jurídico especializado em direito médico e compliance contratual no estado de São Paulo.

Leia o contrato integralmente e identifique, com base no que está EFETIVAMENTE escrito, os pontos de conformidade e desconformidade com:
1. Resolução CREMESP 397/2026 — autonomia técnica, Diretor Técnico, responsabilidade técnica
2. Código de Ética Médica (CFM) — autonomia profissional, sigilo e prontuário
3. Resoluções CFM 1638/2002 e 2218/2018 — prontuário médico
4. LGPD (Lei 13.709/2018) — dados sensíveis de saúde
5. CLT — sinais de subordinação e vínculo empregatício

Verifique: natureza da prestação, local de trabalho, jornada, subordinação, remuneração, pagamento, prazo de vigência, rescisão, responsabilidades, autonomia técnica, Diretor Técnico, SCP, prontuário/sigilo, LGPD.

Cada ponto deve descrever especificamente o que foi encontrado ou a ausência identificada NO CONTRATO ANALISADO. Não use frases genéricas.

Responda SOMENTE em JSON válido, sem markdown:
{
  "status": "CONFORME" | "DESCONFORME" | "INSUFICIENTE",
  "titulo": "frase descritiva de até 10 palavras sobre este contrato",
  "resumo": "síntese objetiva de até 40 palavras",
  "pontos": [{"tipo": "critico"|"atencao"|"ok", "texto": "descrição específica de 10 a 30 palavras"}],
  "observacoes": "observação técnica adicional, se relevante"
}`;
