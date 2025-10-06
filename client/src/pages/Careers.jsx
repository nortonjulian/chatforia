import { Container, Title, Text, Button, Stack } from '@mantine/core';

export default function Careers() {
  return (
    <Container size="md" py="xl">
      <Title order={2} mb="sm">Careers</Title>
      <Text c="dimmed" mb="lg">
        We’re a small team building a private, global messenger. If you care about
        encryption, accessibility, and delightful UX, we’d love to hear from you.
      </Text>
      <Stack gap="xs">
        <Text><b>Open roles:</b> Engineering (Full-stack, iOS, Android), Product, Support.</Text>
        <Text><b>How to apply:</b> Email your resume/links to <a href="mailto:jobs@chatforia.com">jobs@chatforia.com</a>.</Text>
      </Stack>
      <Button mt="lg" component="a" href="mailto:jobs@chatforia.com">Email your resume</Button>
    </Container>
  );
}
