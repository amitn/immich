import { Heading, Link, Section, Text } from '@react-email/components';
import * as React from 'react';
import { ImmichButton } from 'src/emails/components/button.component.js';
import ImmichLayout from 'src/emails/components/immich.layout.js';
import { MemoryDigestEmailProps, MemoryDigestItem } from 'src/repositories/email.repository.js';

const DigestSection = ({ title, items }: { title: string; items: MemoryDigestItem[] }) =>
  items.length === 0 ? null : (
    <Section className="my-4">
      <Heading as="h3" className="m-0 mb-2 text-base">
        {title}
      </Heading>
      {items.map((item) => (
        <Text key={item.url} className="m-0 mb-2">
          <Link href={item.url}>{item.title}</Link>
          {item.subtitle && (
            <>
              <br />
              <span className="text-xs text-immich-footer">{item.subtitle}</span>
            </>
          )}
        </Text>
      ))}
    </Section>
  );

/** the weekly digest of a user's memories, waiting drafts and new journal visits (#6) */
export const MemoryDigestEmail = ({ baseUrl, recipientName, memories, drafts, visits }: MemoryDigestEmailProps) => (
  <ImmichLayout preview="Your week in memories, books waiting for you and new journal visits.">
    <Text className="m-0">
      Hey <strong>{recipientName}</strong>!
    </Text>

    <Text>Here is what your photos had for you this week.</Text>

    <DigestSection title="Memories" items={memories} />
    <DigestSection title="Photo books waiting for you" items={drafts} />
    <DigestSection title="New journal visits to name" items={visits} />

    <Section className="flex justify-center my-6">
      <ImmichButton href={baseUrl}>Open your photos</ImmichButton>
    </Section>

    <Text className="text-xs">
      You get this email because you turned on the weekly digest. You can turn it off in your account settings, under
      memory notifications.
    </Text>
  </ImmichLayout>
);

MemoryDigestEmail.PreviewProps = {
  baseUrl: 'https://photos.example.com',
  recipientName: 'Alan Turing',
  memories: [
    { title: 'Your trip to Lisbon', subtitle: '12–19 August 2023', url: 'https://photos.example.com/memories/1' },
    { title: 'On this day in Porto', url: 'https://photos.example.com/memories/2' },
  ],
  drafts: [{ title: 'Crete 2026', subtitle: 'Your trip to Crete', url: 'https://photos.example.com/books/3' }],
  visits: [
    {
      title: 'Name the dishes from last night at Taormina?',
      subtitle: '12 dishes · Taormina, 26 September 2026',
      url: 'https://photos.example.com/photos/4',
    },
  ],
} as MemoryDigestEmailProps;

export default MemoryDigestEmail;
