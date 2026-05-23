<?php

declare(strict_types=1);

namespace Frontstage\Catalog\Infrastructure\Http\Controller;

use Frontstage\Catalog\Application\Bus\CommandBus;
use Frontstage\Catalog\Application\Command\PublishEvent\PublishEventCommand;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\Routing\Attribute\Route;

final class PublishEventController
{
	public function __construct(private readonly CommandBus $commands)
	{
	}

	#[Route('/events/{id}/publish', name: 'catalog_event_publish', methods: ['POST'])]
	public function __invoke(string $id): Response
	{
		$this->commands->dispatch(new PublishEventCommand($id));

		return new JsonResponse(null, Response::HTTP_NO_CONTENT);
	}
}
