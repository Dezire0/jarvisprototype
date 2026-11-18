module.exports = [
  {
    name: "ask_pii",
    schema: '{"action":"ask_pii","field":"password","reason":"..."}',
    description: "비밀번호가 필요하면 사용자를 사이트 로그인 폼으로 안내",
    execute: async (_action, { safeObserve }) => ({
      state: await safeObserve(),
      error: "Ask the user to enter credentials on the site or use Jarvis’s saved-login flow."
    })
  }
];
