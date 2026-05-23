<?php

declare(strict_types=1);

namespace Frontstage\Reservations\Infrastructure\Http\Controller;

use Frontstage\Reservations\Application\Bus\CommandBus;
use Frontstage\Reservations\Application\Command\ReleaseHold\ReleaseHoldCommand;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\Routing\Attribute\Route;

final class ReleaseHoldController
{
	public function __construct(private readonly CommandBus $commands)
	{
	}

	#[Route('/holds/{id}', name: 'reservations_hold_release', methods: ['DELETE'])]
	public function __invoke(string $id): Response
	{
		$this->commands->dispatch(new ReleaseHoldCommand($id));

		return new JsonResponse(null, Response::HTTP_NO_CONTENT);
	}
}
