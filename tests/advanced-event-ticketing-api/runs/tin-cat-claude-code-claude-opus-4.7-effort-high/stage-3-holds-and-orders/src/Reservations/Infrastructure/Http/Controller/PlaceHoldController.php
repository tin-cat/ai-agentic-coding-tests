<?php

declare(strict_types=1);

namespace Frontstage\Reservations\Infrastructure\Http\Controller;

use Frontstage\Reservations\Application\Bus\CommandBus;
use Frontstage\Reservations\Application\Command\PlaceHold\PlaceHoldCommand;
use Frontstage\Reservations\Infrastructure\Http\JsonRequest;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\Routing\Attribute\Route;
use Symfony\Component\Uid\Uuid;

final class PlaceHoldController
{
	private const DEFAULT_TTL_SECONDS = 600;

	public function __construct(private readonly CommandBus $commands)
	{
	}

	#[Route('/events/{id}/holds', name: 'reservations_hold_place', methods: ['POST'])]
	public function __invoke(string $id, Request $request): Response
	{
		$payload = JsonRequest::decode($request);

		$holdId = isset($payload['id']) && is_string($payload['id']) && '' !== $payload['id']
			? $payload['id']
			: Uuid::v7()->toRfc4122();

		$seatsRaw = is_array($payload['seats'] ?? null) ? array_values($payload['seats']) : [];
		$seats = [];
		foreach ($seatsRaw as $entry) {
			if (!is_array($entry)) {
				continue;
			}
			$seats[] = [
				'section' => (string) ($entry['section'] ?? ''),
				'row' => (string) ($entry['row'] ?? ''),
				'number' => (string) ($entry['number'] ?? ''),
			];
		}

		$quantity = isset($payload['quantity']) && is_int($payload['quantity']) ? $payload['quantity'] : null;
		$ttl = isset($payload['ttlSeconds']) && is_int($payload['ttlSeconds']) && $payload['ttlSeconds'] > 0
			? $payload['ttlSeconds']
			: self::DEFAULT_TTL_SECONDS;

		$this->commands->dispatch(new PlaceHoldCommand(
			holdId: $holdId,
			eventId: $id,
			seats: $seats,
			quantity: $quantity,
			ttlSeconds: $ttl,
		));

		return new JsonResponse(['id' => $holdId], Response::HTTP_CREATED, [
			'Location' => sprintf('/holds/%s', $holdId),
		]);
	}
}
