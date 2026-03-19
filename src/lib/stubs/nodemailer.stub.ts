const createTransport = () => ({
  sendMail: async () => ({ messageId: "" }),
});

export default { createTransport };
