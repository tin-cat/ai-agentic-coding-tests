<?php

declare(strict_types=1);

namespace Frontstage\Catalog\Infrastructure\Http\Controller;

use Frontstage\Catalog\Application\Bus\CommandBus;
use Frontstage\Catalog\Application\Command\CreateEvent\CreateEventCommand;
use Frontstage\Catalog\Infrastructure\Http\JsonRequest;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\Routing\Attribute\Route;
use Symfony\Component\Uid\Uuid;

final class CreateEventController
{
	public function __construct(private readonly CommandBus $commands)
	{
	}

	#[Route('/events', name: 'catalog_event_create', methods: ['POST'])]
	public function __invoke(Request $request): Response
	{
		$payload = JsonRequest::decode($request);

		$id = isset($payload['id']) && is_string($payload['id']) && '' !== $payload['id']
			? $payload['id']
			: Uuid::v7()->toRfc4122();

		$command = new CreateEventCommand(
			eventId: $id,
			title: (string) ($payload['title'] ?? ''),
			description: (string) ($payload['description'] ?? ''),
			startsAtIso: (string) ($payload['startsAt'] ?? ''),
			venueName: (string) ($payload['venueName'] ?? ''),
			seating: is_array($payload['seating'] ?? null) ? $payload['seating'] : [],
			priceTiers: is_array($payload['priceTiers'] ?? null) ? array_values($payload['priceTiers']) : [],
		);

		$this->commands->dispatch($command);

		return new JsonResponse(['id' => $id], Response::HTTP_CREATED, [
			'Location' => sprintf('/events/%s', $id),
		]);
	}
}
