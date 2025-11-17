import React, { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  Badge,
  Button,
  Card,
  Dialog,
  Flex,
  IconButton,
  Popover,
  Text,
  TextField,
} from "@radix-ui/themes";
import { EditIcon, TrashIcon } from "lucide-react";
import { useSettings } from "../../../hooks/useSettings";
import type { PostProcessProvider } from "../../../lib/types";
import { SettingsGroup } from "../../ui";

const DEFAULT_MODELS_ENDPOINT = "/models";

const isValidUrl = (value: string) => {
  const trimmed = value.trim().toLowerCase();
  return trimmed.startsWith("http://") || trimmed.startsWith("https://");
};

interface ProviderManagerProps {
  onClose: () => void;
}

export const ProviderManager: React.FC<ProviderManagerProps> = ({
  onClose,
}) => {
  const { t } = useTranslation();
  const {
    settings,
    addCustomProvider,
    updateCustomProvider,
    removeCustomProvider,
    isUpdating,
  } = useSettings();

  const providers = settings?.post_process_providers || [];
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [addDraft, setAddDraft] = useState({
    label: "",
    baseUrl: "",
    modelsEndpoint: DEFAULT_MODELS_ENDPOINT,
  });
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState({
    label: "",
    baseUrl: "",
    modelsEndpoint: DEFAULT_MODELS_ENDPOINT,
  });

  const handleStartEdit = (provider: PostProcessProvider) => {
    setEditingId(provider.id);
    setEditDraft({
      label: provider.label,
      baseUrl: provider.base_url,
      modelsEndpoint: provider.models_endpoint || DEFAULT_MODELS_ENDPOINT,
    });
    setIsEditDialogOpen(true);
  };

  const handleResetUrl = async () => {
    if (!editingId) return;
    const provider = providers.find((p) => p.id === editingId);
    if (!provider) return;
    setEditDraft((pre) => ({
      ...pre,
      baseUrl: provider.base_url,
    }));
  };

  const handleAdd = async () => {
    await addCustomProvider({
      label: addDraft.label,
      baseUrl: addDraft.baseUrl,
      modelsEndpoint: addDraft.modelsEndpoint,
    });
    setAddDraft({
      label: "",
      baseUrl: "",
      modelsEndpoint: DEFAULT_MODELS_ENDPOINT,
    });
    setIsAddDialogOpen(false);
  };

  const handleSaveEdit = async () => {
    if (!editingId) return;
    await updateCustomProvider({
      providerId: editingId,
      label: editDraft.label,
      baseUrl: editDraft.baseUrl,
      modelsEndpoint: editDraft.modelsEndpoint,
    });
    setEditingId(null);
    setIsEditDialogOpen(false);
  };

  const [deletePopoverOpen, setDeletePopoverOpen] = useState<string | null>(
    null,
  );

  const handleRemove = async (providerId: string) => {
    await removeCustomProvider(providerId);
    setDeletePopoverOpen(null);
  };

  const customProviders = useMemo(
    () => providers.filter((provider) => provider.allow_base_url_edit),
    [providers],
  );

  const builtInProviders = useMemo(
    () => providers.filter((provider) => !provider.allow_base_url_edit),
    [providers],
  );

  const canAdd =
    addDraft.label.trim() &&
    addDraft.baseUrl.trim() &&
    isValidUrl(addDraft.baseUrl);

  const canSaveEdit =
    editDraft.label.trim() &&
    editDraft.baseUrl.trim() &&
    isValidUrl(editDraft.baseUrl);

  const handleClose = () => {
    setIsAddDialogOpen(false);
    setEditingId(null);
    onClose();
  };

  return (
    <>
      <SettingsGroup
        title={t("ui.customProviders")}
        actions={
          <Button
            onClick={() => setIsAddDialogOpen(true)}
            variant="outline"
            disabled={isUpdating("add_custom_provider")}
          >
            {t("ui.createCustomProvider")}
          </Button>
        }
      >
        {providers.length === 0 ? (
          <Flex align="center" justify="center" py="6" px="4">
            <Text size="2" color="gray" className="mb-2">
              {t("ui.noCustomProviders")}
            </Text>
            <Text size="1" color="gray">
              {t("ui.noCustomProvidersDesc")}
            </Text>
          </Flex>
        ) : (
          <Flex wrap="wrap" gap="3" minHeight="490px" className="content-start">
            {providers.map((provider) => {
              const isBuiltIn = !provider.allow_base_url_edit;
              const updating =
                isUpdating(`update_custom_provider:${provider.id}`) ||
                isUpdating(`remove_custom_provider:${provider.id}`);
              return (
                <Card
                  key={provider.id}
                  variant="surface"
                  className="flex-1 min-w-[250px] p-1! h-fit"
                >
                  <Flex direction="column" gap="2" p="3">
                    <Flex direction="column">
                      <Flex gap="1" justify="start" align="center">
                        <Text size="3" weight="medium">
                          {provider.label}
                        </Text>
                        {isBuiltIn && (
                          <Badge size="1">{t("ui.builtInProvider")}</Badge>
                        )}
                        <Flex gap="2" align="center" justify="end" flexGrow="1">
                          <IconButton
                            variant="ghost"
                            size="2"
                            onClick={() => handleStartEdit(provider)}
                            disabled={updating}
                            title={t("ui.edit")}
                          >
                            <EditIcon size={14} />
                          </IconButton>
                          {!isBuiltIn && (
                            <Popover.Root
                              open={deletePopoverOpen === provider.id}
                              onOpenChange={(open) =>
                                setDeletePopoverOpen(open ? provider.id : null)
                              }
                            >
                              <Popover.Trigger>
                                <IconButton
                                  variant="ghost"
                                  size="2"
                                  color="red"
                                  disabled={updating}
                                  title={t("ui.delete")}
                                  className="text-red-600 hover:text-red-700"
                                >
                                  <TrashIcon size={14} />
                                </IconButton>
                              </Popover.Trigger>
                              <Popover.Content side="bottom" align="end">
                                <Flex direction="column" gap="2" width="150px">
                                  <Text
                                    size="2"
                                    weight="medium"
                                    color="red"
                                    align="center"
                                  >
                                    {t("ui.deleteConfirm")}
                                  </Text>
                                  <Text size="1" color="red" align="center">
                                    {t("ui.deleteConfirmDesc")}
                                  </Text>
                                  <Flex gap="2" justify="center">
                                    <Button
                                      variant="outline"
                                      size="1"
                                      onClick={() => setDeletePopoverOpen(null)}
                                    >
                                      {t("ui.cancel")}
                                    </Button>
                                    <Button
                                      variant="solid"
                                      size="1"
                                      color="red"
                                      onClick={() => handleRemove(provider.id)}
                                      disabled={updating}
                                    >
                                      {t("ui.delete")}
                                    </Button>
                                  </Flex>
                                </Flex>
                              </Popover.Content>
                            </Popover.Root>
                          )}
                        </Flex>
                      </Flex>
                      <Text size="1" color="gray" className="text-xs">
                        {provider.id}
                      </Text>
                    </Flex>
                    <Flex direction="column" gap="1">
                      <Text size="1" color="gray">
                        {provider.base_url}
                      </Text>
                    </Flex>
                  </Flex>
                </Card>
              );
            })}
          </Flex>
        )}
      </SettingsGroup>

      {/* Add Provider Dialog */}
      <Dialog.Root open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
        <Dialog.Content maxWidth="450px">
          <Dialog.Title>{t("ui.createCustomProviderTitle")}</Dialog.Title>

          <Flex direction="column" gap="4" mt="4">
            <Flex direction="column" gap="3">
              <Flex direction="column" gap="1">
                <Text size="2" weight="medium">
                  {t("ui.providerName")}
                </Text>
                <TextField.Root
                  value={addDraft.label}
                  onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                    setAddDraft((draft) => ({
                      ...draft,
                      label: event.target.value,
                    }))
                  }
                  placeholder={t("ui.providerNamePlaceholder")}
                />
              </Flex>
              <Flex direction="column" gap="1">
                <Text size="2" weight="medium">
                  {t("ui.baseUrl")}
                </Text>
                <TextField.Root
                  value={addDraft.baseUrl}
                  onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                    setAddDraft((draft) => ({
                      ...draft,
                      baseUrl: event.target.value,
                    }))
                  }
                  placeholder="https://..."
                />
              </Flex>
              <Flex direction="column" gap="1">
                <Text size="2" weight="medium">
                  {t("ui.modelsEndpoint")}
                </Text>
                <TextField.Root
                  value={addDraft.modelsEndpoint}
                  onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                    setAddDraft((draft) => ({
                      ...draft,
                      modelsEndpoint: event.target.value,
                    }))
                  }
                  placeholder={t("ui.modelsEndpointPlaceholder")}
                />
              </Flex>
            </Flex>
          </Flex>

          <Flex justify="end" gap="3" mt="6">
            <Dialog.Close>
              <Button variant="ghost">{t("ui.cancel")}</Button>
            </Dialog.Close>
            <Dialog.Close>
              <Button
                variant="solid"
                disabled={!canAdd || isUpdating("add_custom_provider")}
                onClick={handleAdd}
              >
                {t("ui.create")}
              </Button>
            </Dialog.Close>
          </Flex>
        </Dialog.Content>
      </Dialog.Root>

      {/* Edit Provider Dialog */}
      <Dialog.Root open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <Dialog.Content maxWidth="450px">
          <Dialog.Title>{t("ui.editProvider")}</Dialog.Title>

          <Flex direction="column" gap="4" mt="4">
            <Flex direction="column" gap="3">
              <Flex direction="column" gap="1">
                <Text size="2" weight="medium">
                  {t("ui.providerName")}
                </Text>
                <TextField.Root
                  value={editDraft.label}
                  onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                    setEditDraft((draft) => ({
                      ...draft,
                      label: event.target.value,
                    }))
                  }
                  placeholder={t("ui.providerNamePlaceholder")}
                />
              </Flex>
              <Flex direction="column" gap="1">
                <Flex justify="between" align="center">
                  <Text size="2" weight="medium">
                    {t("ui.baseUrl")}
                  </Text>
                  {editingId &&
                    !providers.find((p) => p.id === editingId)
                      ?.allow_base_url_edit && (
                      <Button
                        variant="ghost"
                        size="1"
                        onClick={handleResetUrl}
                        disabled={isUpdating(
                          `update_custom_provider:${editingId}`,
                        )}
                      >
                        {t("ui.resetUrl")}
                      </Button>
                    )}
                </Flex>
                <TextField.Root
                  value={editDraft.baseUrl}
                  onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                    setEditDraft((draft) => ({
                      ...draft,
                      baseUrl: event.target.value,
                    }))
                  }
                  placeholder="https://..."
                />
              </Flex>
              <Flex direction="column" gap="1">
                <Text size="2" weight="medium">
                  {t("ui.modelsEndpoint")}
                </Text>
                <TextField.Root
                  value={editDraft.modelsEndpoint}
                  onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                    setEditDraft((draft) => ({
                      ...draft,
                      modelsEndpoint: event.target.value,
                    }))
                  }
                  placeholder={t("ui.modelsEndpointPlaceholder")}
                />
              </Flex>
            </Flex>
          </Flex>

          <Flex justify="end" gap="3" mt="6">
            <Dialog.Close>
              <Button variant="ghost">{t("ui.cancel")}</Button>
            </Dialog.Close>
            <Dialog.Close>
              <Button
                variant="solid"
                disabled={
                  !canSaveEdit ||
                  isUpdating(`update_custom_provider:${editingId}`)
                }
                onClick={handleSaveEdit}
              >
                {t("ui.save")}
              </Button>
            </Dialog.Close>
          </Flex>
        </Dialog.Content>
      </Dialog.Root>
    </>
  );
};

export default ProviderManager;
