export async function claimCallActive({
  callModel,
  callId,
  data,
  select,
}) {
  const result =
    await callModel.updateMany({
      where: {
        id: callId,
        status: {
          in: [
            'RINGING',
            'INITIATED',
          ],
        },
      },
      data,
    });

  const call =
    await callModel.findUnique({
      where: {
        id: callId,
      },
      select,
    });

  return {
    won: result.count === 1,
    call,
  };
}
