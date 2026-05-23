<?php

declare(strict_types=1);

namespace Frontstage\Tests\Functional\Catalog;

use Frontstage\Tests\Functional\ApiTestCase;

final class EventLifecycleTest extends ApiTestCase
{
	public function testCreatePublishGetAndListSectionedEvent(): void
	{
		$payload = [
			'id' => '11111111-1111-4111-8111-111111111111',
			'title' => 'Symphony Night',
			'description' => 'An evening of music.',
			'startsAt' => '2026-09-12T19:30:00+00:00',
			'venueName' => 'Grand Hall',
			'priceTiers' => [
				['id' => 'general', 'name' => 'General', 'priceAmount' => 5000, 'priceCurrency' => 'USD'],
				['id' => 'vip', 'name' => 'VIP', 'priceAmount' => 15000, 'priceCurrency' => 'USD'],
			],
			'seating' => [
				'type' => 'sectioned',
				'sections' => [
					[
						'name' => 'Orchestra',
						'rows' => [
							[
								'label' => 'A',
								'seats' => [
									['number' => '1', 'priceTierId' => 'vip'],
									['number' => '2', 'priceTierId' => 'vip'],
								],
							],
							[
								'label' => 'B',
								'seats' => [
									['number' => '1', 'priceTierId' => 'general'],
									['number' => '2', 'priceTierId' => 'general'],
									['number' => '3', 'priceTierId' => 'general'],
								],
							],
						],
					],
				],
			],
		];

		$created = $this->request('POST', '/events', $payload);
		$this->assertStatus(201);
		$this->assertIsArray($created);
		$this->assertSame($payload['id'], $created['id']);

		// Before publish, list endpoint should not include it.
		$listed = $this->request('GET', '/events');
		$this->assertStatusOk();
		$this->assertSame([], $listed['events']);

		// Detail endpoint works for drafts (per the spec we can fetch by id).
		$detail = $this->request('GET', '/events/'.$payload['id']);
		$this->assertStatusOk();
		$this->assertSame('draft', $detail['status']);
		$this->assertSame(5, $detail['totalCapacity']);
		$this->assertSame(5, $detail['availableSeatCount']);
		$this->assertSame('sectioned', $detail['seating']['type']);
		$this->assertCount(1, $detail['seating']['sections']);
		$this->assertSame('Orchestra', $detail['seating']['sections'][0]['name']);
		$this->assertCount(2, $detail['seating']['sections'][0]['rows']);
		$this->assertCount(2, $detail['priceTiers']);
		$this->assertSame(5000, $detail['priceTiers'][0]['price']['amount']);
		$this->assertTrue($detail['seating']['sections'][0]['rows'][0]['seats'][0]['available']);

		// Publish the event.
		$this->request('POST', '/events/'.$payload['id'].'/publish');
		$this->assertStatus(204);

		// Now the published event shows up in the listing.
		$listed = $this->request('GET', '/events');
		$this->assertStatusOk();
		$this->assertCount(1, $listed['events']);
		$this->assertSame($payload['id'], $listed['events'][0]['id']);
		$this->assertSame(5, $listed['events'][0]['totalCapacity']);

		// Detail reflects new status.
		$detail = $this->request('GET', '/events/'.$payload['id']);
		$this->assertStatusOk();
		$this->assertSame('published', $detail['status']);
	}

	public function testCreateAndPublishGeneralAdmissionEvent(): void
	{
		$payload = [
			'id' => '22222222-2222-4222-8222-222222222222',
			'title' => 'Open Mic',
			'description' => 'Anything goes.',
			'startsAt' => '2026-10-01T20:00:00+00:00',
			'venueName' => 'Basement',
			'priceTiers' => [
				['id' => 'general', 'name' => 'General', 'priceAmount' => 1000, 'priceCurrency' => 'USD'],
			],
			'seating' => [
				'type' => 'general_admission',
				'capacity' => 30,
				'priceTierId' => 'general',
			],
		];

		$this->request('POST', '/events', $payload);
		$this->assertStatus(201);

		$this->request('POST', '/events/'.$payload['id'].'/publish');
		$this->assertStatus(204);

		$detail = $this->request('GET', '/events/'.$payload['id']);
		$this->assertStatusOk();

		$this->assertSame('general_admission', $detail['seating']['type']);
		$this->assertSame(30, $detail['seating']['capacity']);
		$this->assertSame('general', $detail['seating']['priceTierId']);
		$this->assertSame(30, $detail['totalCapacity']);
		$this->assertSame(30, $detail['availableSeatCount']);
	}

	public function testGetUnknownEventReturns404(): void
	{
		$body = $this->request('GET', '/events/99999999-9999-4999-8999-999999999999');
		$this->assertStatus(404);
		$this->assertArrayHasKey('error', $body);
	}

	public function testCreateRejectsInvalidPayload(): void
	{
		$this->request('POST', '/events', [
			'id' => 'not-a-uuid',
			'title' => '',
			'description' => '',
			'startsAt' => 'whenever',
			'venueName' => '',
			'priceTiers' => [],
			'seating' => ['type' => 'sectioned', 'sections' => []],
		]);
		$this->assertStatus(400);
	}

	public function testPublishingTwiceReturnsConflict(): void
	{
		$payload = [
			'id' => '33333333-3333-4333-8333-333333333333',
			'title' => 'Repeat Show',
			'description' => '',
			'startsAt' => '2026-11-01T19:00:00+00:00',
			'venueName' => 'Studio A',
			'priceTiers' => [
				['id' => 'general', 'name' => 'General', 'priceAmount' => 0, 'priceCurrency' => 'USD'],
			],
			'seating' => [
				'type' => 'general_admission',
				'capacity' => 10,
				'priceTierId' => 'general',
			],
		];

		$this->request('POST', '/events', $payload);
		$this->assertStatus(201);

		$this->request('POST', '/events/'.$payload['id'].'/publish');
		$this->assertStatus(204);

		$this->request('POST', '/events/'.$payload['id'].'/publish');
		$this->assertStatus(409);
	}
}
