export default async function handler(req, res) {
  // Allow CORS from nuantra.com
  res.setHeader('Access-Control-Allow-Origin', 'https://nuantra.com');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { name, email } = req.body;

  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'Valid email required' });
  }

  try {
    const response = await fetch('https://api.brevo.com/v3/contacts', {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'content-type': 'application/json',
        'api-key': process.env.BREVO_API_KEY
      },
      body: JSON.stringify({
        email: email,
        attributes: { FIRSTNAME: name || '' },
        listIds: [3],          // Vishnu Sahasranama Journey list ID = 3
        updateEnabled: false   // Do not re-trigger automation if already subscribed
      })
    });

    // 201 = created, 204 = already exists (both are fine)
    if (response.status === 201 || response.status === 204) {
      return res.status(200).json({ success: true });
    }

    const data = await response.json();

    // Brevo returns 400 with code "duplicate_parameter" if already subscribed
    if (data.code === 'duplicate_parameter') {
      return res.status(200).json({ success: true, note: 'already_subscribed' });
    }

    return res.status(400).json({ error: data.message || 'Brevo error' });

  } catch (err) {
    return res.status(500).json({ error: 'Server error' });
  }
}