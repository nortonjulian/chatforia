import { Container, Title, Text, Button } from '@mantine/core';

export default function DoNotSellMyInfo() {
  return (
    <Container size="md" py="xl">
      <Title order={2}>Do Not Sell or Share My Personal Information</Title>
      <Text c="dimmed" mb="md">
        Chatforia does not sell personal information. California residents can still submit
        requests under CPRA using the button below.
      </Text>
      <Button component="a" href="mailto:privacy@chatforia.com?subject=CPRA%20Request">Submit a request</Button>
    </Container>
  );
}
