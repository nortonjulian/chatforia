class FakeOpenAI {
  constructor() {}

  chat = {
    completions: {
      create: async () => ({
        choices: [
          { message: { content: JSON.stringify({ suggestions: [] }) } },
        ],
      }),
    },
  };
}

export default FakeOpenAI;
export { FakeOpenAI };
