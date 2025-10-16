async function auth(request, env, ctx) {
	if (request.method !== 'POST') {
		return new Response('Method Not Allowed', { status: 405 });
	}

	console.log('SHIBA');
	const formData = await request.formData();
	const username = formData.get('username');
	const password = formData.get('password');

	console.log('Auth attempt:', username, password);
	console.log('Expected:', env.AUTH_USERNAME, env.AUTH_PASSWORD);

	if (username === env.AUTH_USERNAME && password === env.AUTH_PASSWORD) {
		const response = new Response(null, {
			status: 302,
			headers: {
				Location: '/',
				'Set-Cookie': `user=highstakes; Path=/; HttpOnly; SameSite=Lax`,
			},
		});
		return response;
	}

	return new Response(null, {
		status: 302,
		headers: {
			Location: '/login/?invalid=true',
		},
	});
}

export { auth };
